"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { AudioLines, Mic, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppDialog } from "@/components/app-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MESSAGES } from "@/lib/constants";
import { TRANSCRIPTION_STATUSES, TRANSCRIPTION_STATUS_LABELS } from "@/lib/data/kysely-database-types";
import { formatDateTime } from "@/lib/format";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { cn } from "@/lib/utils";

import { deleteTranscriptionAction, renameTranscriptionAction } from "../transcription.actions";
import {
  TITLE_MAX_CHARS,
  formatDuration,
  type TranscriptionPageDTO,
  type TranscriptionSummaryDTO,
} from "../transcription.types";
import { TranscriptionComposer } from "./transcription-composer";
import { TranscriptionDetail } from "./transcription-detail";

// -------------------------------------------------------------------
// TranscriptionWorkspace
//
// The two-column shell: transcriptions down the left, the open one on the
// right. Deliberately the same shape as AI chat - they are the same kind of
// screen, and a person who has used one should not have to learn the other.
//
// Which transcription is open lives in the URL (`?id=<id>`) rather than in
// state, so it is linkable, survives a refresh and works with the back
// button. The server re-checks that id against the session on every render,
// so putting it in the URL grants nothing.
//
// STARTING A NEW ONE IS LOCAL STATE, not a URL, and that is the one place
// this differs. A recording in progress only exists in the browser's
// memory; a route change would end it. Keeping the composer out of the URL
// means nothing about navigation can silently discard a meeting.
// -------------------------------------------------------------------
export function TranscriptionWorkspace({ page }: { page: TranscriptionPageDTO }) {
  const router = useRouter();
  // The area this is mounted under (/admin/transcription, ...). Read rather
  // than passed, so the same component works in all three without a prop
  // that could disagree with where it actually is.
  const pathname = usePathname();

  const [isPending, startTransition] = useTransition();
  // Opens on the composer when there is nothing to show, which is what a
  // first visit looks like.
  const [isCreating, setIsCreating] = useState(page.transcriptions.length === 0);
  const [renaming, setRenaming] = useState<TranscriptionSummaryDTO | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [deleting, setDeleting] = useState<TranscriptionSummaryDTO | null>(null);

  const activeId = page.active?.id ?? null;

  const isReady = page.isStorageConfigured && page.isSpeechConfigured && page.isStorageReachableByAzure;

  const openTranscription = (transcriptionId: string) => {
    setIsCreating(false);
    router.push(`${pathname}?id=${transcriptionId}`);
  };

  const submitRename = () =>
    startTransition(async () => {
      if (!renaming) return;

      try {
        const response = await renameTranscriptionAction({
          transcriptionId: renaming.id,
          title: renameTitle,
        });

        if (!response.success) {
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        setRenaming(null);
        toast.success(MESSAGES.TRANSCRIPTION_RENAMED);
        router.refresh();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  const confirmDelete = () =>
    startTransition(async () => {
      if (!deleting) return;

      try {
        const response = await deleteTranscriptionAction({ transcriptionId: deleting.id });

        if (!response.success) {
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        const wasOpen = deleting.id === activeId;
        setDeleting(null);
        toast.success(MESSAGES.TRANSCRIPTION_DELETED);

        // Deleting the open one leaves the URL pointing at something that
        // no longer exists. Drop the query so the server picks the next
        // most recent instead of rendering nothing.
        if (wasOpen) router.push(pathname);
        else router.refresh();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        {/* Transcriptions */}
        <aside className="flex min-w-0 flex-col gap-3">
          <Button
            onClick={() => setIsCreating(true)}
            disabled={!isReady || isCreating}
            className="w-full justify-center"
          >
            <Plus size={16} aria-hidden="true" />
            New transcription
          </Button>

          {page.transcriptions.length === 0 ? (
            <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
              Nothing yet. Record a meeting or upload one to see it here.
            </p>
          ) : (
            <nav aria-label="Transcriptions">
              <ul className="space-y-1">
                {page.transcriptions.map((transcription) => {
                  const isActive = !isCreating && transcription.id === activeId;

                  return (
                    <li key={transcription.id} className="group/item relative">
                      <Link
                        href={`${pathname}?id=${transcription.id}`}
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => setIsCreating(false)}
                        className={cn(
                          "block rounded-lg py-2 pl-3 pr-16 transition-colors",
                          isActive ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted",
                        )}
                      >
                        <span className="block truncate text-sm font-medium">{transcription.title}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          {transcription.status === TRANSCRIPTION_STATUSES.COMPLETED ? (
                            <span className="text-xs text-muted-foreground">
                              {formatDateTime(transcription.createdAt)}
                              {transcription.durationSeconds !== null
                                ? ` - ${formatDuration(transcription.durationSeconds)}`
                                : ""}
                            </span>
                          ) : (
                            // Only shown while it means something. A badge
                            // saying "Ready" on every finished row is noise
                            // in a list where finished is the normal state.
                            <Badge
                              variant={
                                transcription.status === TRANSCRIPTION_STATUSES.FAILED
                                  ? "destructive"
                                  : "warning"
                              }
                            >
                              {TRANSCRIPTION_STATUS_LABELS[transcription.status]}
                            </Badge>
                          )}
                        </span>
                      </Link>

                      {/* Per-row actions. Shown on hover on a pointer
                          device, and always once focused, so they are
                          reachable from the keyboard rather than
                          hover-only. */}
                      <span className="absolute right-1 top-1.5 flex opacity-0 transition-opacity focus-within:opacity-100 group-hover/item:opacity-100">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Rename ${transcription.title}`}
                          onClick={() => {
                            setRenaming(transcription);
                            setRenameTitle(transcription.title);
                          }}
                        >
                          <Pencil size={14} aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Delete ${transcription.title}`}
                          onClick={() => setDeleting(transcription)}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </Button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </nav>
          )}
        </aside>

        {/* The open transcription, or a new one */}
        <section className="min-w-0">
          {!isReady ? (
            <NotConfigured page={page} />
          ) : isCreating || page.active === null ? (
            <TranscriptionComposer onStarted={openTranscription} />
          ) : (
            // Keyed on the row so opening a different one remounts and
            // resets the polling and the open tab. Without the key React
            // would keep the previous transcription's local state.
            <TranscriptionDetail key={page.active.id} detail={page.active} />
          )}
        </section>
      </div>

      {/* Rename. AppDialog rather than ConfirmDialog because this needs a
          real field, and ConfirmDialog's description renders inside a <p> -
          an input nested in a paragraph is invalid markup. */}
      <AppDialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
        title="Rename transcription"
        description="Only you see this name."
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitRename();
          }}
          className="space-y-5"
        >
          <div className="grid gap-2">
            <Label htmlFor="transcription-rename">Name</Label>
            <Input
              id="transcription-rename"
              value={renameTitle}
              maxLength={TITLE_MAX_CHARS}
              onChange={(event) => setRenameTitle(event.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || renameTitle.trim().length === 0} loading={isPending}>
              {isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </AppDialog>

      {/* Delete */}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete this transcription?"
        description={`"${deleting?.title ?? ""}", its transcript and its summary will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete"
        pendingLabel="Deleting..."
        isPending={isPending}
        onConfirm={confirmDelete}
      />
    </>
  );
}

// -------------------------------------------------------------------
// Three ways to be not-ready, three different sentences.
//
// Reducing them to one "Transcription is not configured" would send
// somebody looking in the wrong place - and the third one especially,
// because everything about that setup LOOKS right: the key is set, the
// storage is set, the recorder works, the upload succeeds. Only the job
// fails, minutes later, with a message from Azure about a URI.
//
// Shown INSTEAD of the composer rather than as a warning above it. A
// warning would let somebody record a meeting anyway and lose it.
// -------------------------------------------------------------------
function NotConfigured({ page }: { page: TranscriptionPageDTO }) {
  const { title, detail } = !page.isStorageConfigured
    ? {
        title: "Transcription is not configured",
        detail:
          "There is nowhere to put a recording on this environment. Set AZURE_STORAGE_CONNECTION_STRING and restart.",
      }
    : !page.isSpeechConfigured
      ? {
          title: "Transcription is not configured",
          detail:
            "Recordings can be stored but nothing can transcribe them. Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION and restart.",
        }
      : {
          title: "Transcription cannot run against local storage",
          detail:
            "Azure downloads the recording itself and cannot reach the storage emulator on this machine. Everything else works locally - to transcribe, point AZURE_STORAGE_CONNECTION_STRING at a real storage account.",
        };

  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center rounded-xl border border-border bg-muted/40 px-6 py-16 text-center"
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {page.isStorageConfigured ? (
          <AudioLines size={22} aria-hidden="true" />
        ) : (
          <Mic size={22} aria-hidden="true" />
        )}
      </span>
      <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}
