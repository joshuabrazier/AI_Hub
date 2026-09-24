import "server-only";

import { requireUser } from "@/lib/auth/session-auth-server";
import {
  inspectAttachment,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS_PER_REQUEST,
  MAX_IMAGE_BYTES,
  MAX_REQUEST_ATTACHMENT_BYTES,
  formatBytes,
  type AttachmentInspection,
} from "@/lib/ai/attachment-formats";
import {
  downloadSharepointFile,
  searchSharepointFiles,
  type SharepointFileHit,
} from "@/lib/sharepoint/file-search";
import {
  GRAPH_OUTCOMES,
  graphInnerErrorOf,
  graphOutcomeOf,
  graphStatusOf,
} from "@/lib/sharepoint/graph-client";
import { getDelegatedGraphToken } from "@/lib/sharepoint/graph-token";

// ===================================================================
// SHAREPOINT, FOR THE CHAT
//
// THE ACTOR COMES FROM THE SESSION AND FROM NOWHERE ELSE. Every function
// here calls `requireUser` itself and mints a Graph token for THAT id -
// never for anything the model emitted, and there is deliberately no
// argument one could arrive in. This is the same rule the timesheet tool
// runs on, and here it carries even more weight, because the token it
// produces is the whole access-control boundary: Graph decides what comes
// back, against the identity of the person who typed the question.
//
// graph-token.ts warns that its headerless form is a privileged path that
// "must never be reachable from a request handler with a user id taken off
// a URL or a form". The chat stream IS a request handler, so that warning
// is pointed straight at this file. It is satisfied by the id coming from
// `requireUser()` - a session Better Auth verified - and it would be
// violated the moment somebody added a `userId` argument to either function
// below, however well-meant. Do not.
//
// WHAT THE MODEL GETS IS NOT FINISHED. A timesheet figure is a number this
// app computed; a SharePoint document is a file a colleague or a client
// wrote, and it can contain anything, including text addressed to whatever
// model reads it. So this tool sits with the web search rather than with
// the timesheet one: read-only and session-scoped, but its content is
// material and never instruction, and it is fenced and labelled as such
// where it is handed over.
// ===================================================================

// ===================================================================
// HOW MANY FILES ONE MESSAGE MAY OPEN
//
// DERIVED, NOT CHOSEN. This was a flat 2, and 2 was a guess - lower than
// the API allows for no reason anybody could point at, and wrong in the
// other direction too, because a fixed number cannot know what the
// conversation has already spent.
//
// The real constraint is Bedrock's, it is per REQUEST, and every send
// replays the whole thread: 5 documents and MAX_REQUEST_ATTACHMENT_BYTES
// across everything in the call. A file read by the tool is a document
// block in that same request, sitting alongside whatever the person has
// attached to the conversation - so four attached PDFs plus two read from
// SharePoint is six, which Bedrock refuses. It refuses the WHOLE TURN,
// after the model has been asked and paid for, and the reader sees a
// failed reply rather than an answer.
//
// So the allowance is whatever selectAttachments did NOT use. An ordinary
// conversation with nothing attached gets all five; one carrying four
// documents gets one and is told so; one already at the cap gets none and
// is told THAT, which is a sentence the model can pass on rather than a
// send that dies.
// ===================================================================

export type SharepointTurnBudget = {
  filesRead: number;
  bytesRead: number;
  /** Files this turn may still open. Zero is a legitimate answer. */
  maxFiles: number;
  maxBytes: number;
};

/**
 * @param spent What the conversation's own attachments already used in this
 *   request. Defaults to nothing spent, which is right for a caller that has
 *   no attachments to account for and safe because the ceilings below are
 *   the API's own.
 */
export function createSharepointTurnBudget(
  spent: { documents?: number; bytes?: number } = {},
): SharepointTurnBudget {
  return {
    filesRead: 0,
    bytesRead: 0,
    maxFiles: Math.max(0, MAX_DOCUMENTS_PER_REQUEST - (spent.documents ?? 0)),
    maxBytes: Math.max(0, MAX_REQUEST_ATTACHMENT_BYTES - (spent.bytes ?? 0)),
  };
}

export type SharepointFileContent = {
  name: string;
  /** Bedrock's own format name, from the BYTES rather than from the filename. */
  format: string;
  kind: "image" | "document";
  bytes: Buffer;
  sizeBytes: number;
  webUrl: string | null;
};

export type SharepointSearchOutcome =
  | { ok: true; query: string; files: SharepointFileHit[] }
  | { ok: false; error: string };

export type SharepointReadOutcome =
  | { ok: true; file: SharepointFileContent }
  | { ok: false; error: string };

// -------------------------------------------------------------------
// Turn a Graph failure into a sentence the person reading the chat can act
// on, and never into an exception.
//
// FOUR CASES WITH FOUR DIFFERENT REMEDIES, and the sharepoint admin service
// makes the same split for the same reason: a re-auth needs a person to sign
// in, a throttle needs waiting, a refusal needs somebody to look at the
// status, and no answer at all is the only one worth retrying. Collapsing
// them sends people after the wrong problem - which is not hypothetical
// here, see the note on the refusal branch.
//
// NEEDS_REAUTH is the one that will actually happen. The Graph scopes were
// added after some people had already signed in, and a refresh token keeps
// the scopes it was issued with - so until they sign in again, Microsoft
// refuses, and the honest answer names the remedy rather than saying
// something went wrong.
// -------------------------------------------------------------------
function describeGraphFailure(operation: string, error: unknown, detail: Record<string, string> = {}): string {
  const outcome = graphOutcomeOf(error);
  const status = graphStatusOf(error);
  const innerError = graphInnerErrorOf(error);

  // ONE GREPPABLE LINE, on the transcription-logging pattern: the operation,
  // the status and the ids, and never the FILENAME. A document title is typed
  // by a person and routinely carries a client's name; an id identifies the
  // row without describing anybody's business, so this line is safe to paste
  // into a ticket - which is the only kind of log anybody actually uses.
  console.error("sharepoint-chat-files: graph call failed", {
    operation,
    status,
    innerError,
    outcome,
    ...detail,
    message: error instanceof Error ? error.message : String(error),
  });

  if (outcome === GRAPH_OUTCOMES.NEEDS_REAUTH) {
    return "Microsoft would not grant access to SharePoint. Signing out and back in with Microsoft usually fixes it, because access to files was added after some people last signed in.";
  }

  if (outcome === GRAPH_OUTCOMES.THROTTLED) {
    return "SharePoint is rate-limiting this app at the moment. Try again in a minute.";
  }

  // -----------------------------------------------------------------
  // A STATUS MEANS MICROSOFT ANSWERED, SO DO NOT SAY IT DID NOT.
  //
  // This branch used to return "SharePoint could not be reached just now."
  // for everything it had not classified, and that sentence cost somebody
  // four exchanges: the model read it, quite reasonably concluded there was
  // an outage, and told them so with increasing confidence while offering to
  // keep retrying something that was never going to start working. The
  // search in the same conversation had just succeeded, on the same token
  // through the same client - so "cannot reach SharePoint" was not merely
  // unproven, it was contradicted by the previous tool call.
  //
  // A guess dressed as a diagnosis is worse than no diagnosis. The status
  // goes in the sentence so the model reports a fact instead of inventing a
  // cause, and so the person reading the chat can say a number out loud to
  // whoever can fix it.
  // -----------------------------------------------------------------
  if (status !== null) {
    const because = innerError ? ` (${innerError})` : "";

    return `SharePoint refused that with HTTP ${status}${because}. This is not a connection problem - Microsoft answered, it just would not do it. Report the status rather than retrying, because the same request will be refused the same way.`;
  }

  return "SharePoint did not answer in time. This one is worth retrying once.";
}

// -------------------------------------------------------------------
// Find files this person can see.
// -------------------------------------------------------------------
export async function findSharepointFilesService(
  query: string,
  count?: number,
): Promise<SharepointSearchOutcome> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { ok: false, error: "A search needs something to search for." };
  }

  try {
    const user = await requireUser();
    const token = await getDelegatedGraphToken(user.id);
    const files = await searchSharepointFiles(token, trimmed, count);

    return { ok: true, query: trimmed, files };
  } catch (error) {
    return { ok: false, error: describeGraphFailure("search", error) };
  }
}

// -------------------------------------------------------------------
// Read one file.
//
// THE TYPE COMES FROM THE BYTES. `inspectAttachment` sniffs the header, the
// same pass an uploaded file goes through, and the allowlist it checks
// against IS the Converse contract - so a file Bedrock would refuse is
// refused here, by name, instead of arriving as a failed send. SharePoint's
// own content type is not consulted and neither is the extension: a `.docx`
// that is really a zip of something else is a real thing, and the failure
// it causes downstream says nothing useful.
//
// THE BUDGET IS CHECKED BEFORE THE DOWNLOAD and charged after it. Checking
// first is what stops a model burning a turn's Graph calls on files it
// cannot be given; charging after is what makes the size real, because
// Graph's reported size and the bytes that arrive are not always the same
// number.
// -------------------------------------------------------------------
export async function readSharepointFileService(
  driveId: string,
  itemId: string,
  fileName: string,
  budget: SharepointTurnBudget,
): Promise<SharepointReadOutcome> {
  if (!driveId.trim() || !itemId.trim()) {
    return { ok: false, error: "Reading a file needs both its driveId and its itemId, from a search result." };
  }

  if (budget.filesRead >= budget.maxFiles) {
    // Two different situations, and telling them apart is the difference
    // between a model that asks a sensible follow-up and one that keeps
    // trying. None available means the conversation's own attachments have
    // taken every slot, and reading anything at all needs a new chat.
    return {
      ok: false,
      error:
        budget.maxFiles === 0
          ? "No files can be opened in this message - the files already attached to this conversation have used the whole limit for one request. Starting a new chat, or removing an attachment, would free it up."
          : `Only ${budget.maxFiles} file${budget.maxFiles === 1 ? "" : "s"} can be opened per message, and that is used up. Answer from what you have already read, or ask the user which one they want next.`,
    };
  }

  let bytes: Buffer;
  try {
    const user = await requireUser();
    const token = await getDelegatedGraphToken(user.id);
    bytes = await downloadSharepointFile(token, driveId, itemId);
  } catch (error) {
    // The ids go in the log line because this is the failure that needs them:
    // a download refused for one item while search works is a question about
    // WHICH item, and the answer is not in the message.
    return { ok: false, error: describeGraphFailure("download", error, { driveId, itemId }) };
  }

  if (bytes.byteLength === 0) {
    return { ok: false, error: "That file is empty." };
  }

  if (budget.bytesRead + bytes.byteLength > budget.maxBytes) {
    return {
      ok: false,
      error: "That file is too large to open alongside what has already been read in this message.",
    };
  }

  const inspection: AttachmentInspection = inspectAttachment(bytes, fileName);

  if (!inspection.ok) {
    // inspectAttachment's refusal already names the format or the size, and
    // it is written for somebody reading a chat rather than a log.
    return { ok: false, error: inspection.reason };
  }

  const kind = inspection.kind === "image" ? "image" : "document";
  const ceiling = kind === "image" ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES;

  if (bytes.byteLength > ceiling) {
    return {
      ok: false,
      error: `That file is ${formatBytes(bytes.byteLength)}, over the ${formatBytes(ceiling)} limit for reading a file. Ask the user to send the part they need.`,
    };
  }

  budget.filesRead += 1;
  budget.bytesRead += bytes.byteLength;

  return {
    ok: true,
    file: {
      name: fileName,
      format: inspection.format,
      kind,
      bytes,
      sizeBytes: bytes.byteLength,
      webUrl: null,
    },
  };
}
