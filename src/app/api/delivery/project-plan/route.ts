import { NextResponse } from "next/server";

import { applyProjectPlanService, planProjectService } from "@/features/delivery/project-plan.service";
import { ACCESS_TOKEN_SCOPES } from "@/lib/auth/access-token";
import { authenticateAccessToken } from "@/lib/auth/access-token-auth";
import { ProjectPlanDraftSchema } from "@/lib/delivery/project-plan";
import { isDisplayError } from "@/lib/errors";
import { MESSAGES } from "@/lib/constants";

// Kysely needs Node, and an answer about what exists right now must never be
// cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ===================================================================
// POST /api/delivery/project-plan
//
// The one door a personal access token opens, and the only surface in this
// app reachable without a browser session and a second factor. Everything
// about it is shaped by that.
//
// TWO ACTIONS BEHIND ONE ROUTE, and the difference between them is the whole
// design:
//
//   { "confirm": false }   resolve the plan and return it. Reads only.
//   { "confirm": true }    resolve it again and write it.
//
// THE DRY RUN IS THE POINT. A caller - a model, in practice - sends the plan
// once and gets back what would happen: which client, how many tasks, who
// they would be assigned to, and every warning. A person reads that and says
// yes. Only then does anything get written, and Claude Code's own permission
// prompt sits on the second call.
//
// IT RE-RESOLVES ON THE WRITE rather than trusting what it returned a moment
// ago. The catalogue can change between the two calls - a client renamed, an
// account deactivated - and a plan applied from a stale resolution is a
// project attached to whatever that id means now. Re-resolving costs two
// reads and means the write and the review were computed the same way, from
// the same source, with blockers checked twice.
//
// AUTHORIZATION IS IN THREE PLACES ON PURPOSE. The token proves who is
// calling and that the token may reach delivery at all; the service refuses
// a non-admin; and the transaction re-checks before it writes. None of the
// three is redundant, because this is the path with no session in front of
// it and therefore no proxy, no layout guard and no second factor.
//
// EVERY 401 LOOKS THE SAME. Revoked, expired, deactivated, never issued - one
// answer. Saying "that token is expired" confirms it was real to somebody who
// found it written down.
// ===================================================================
export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateAccessToken(request, ACCESS_TOKEN_SCOPES.DELIVERY_WRITE);

  if (!auth.ok) {
    // Logged with the reason, answered without it.
    console.warn(`[POST /api/delivery/project-plan] refused: ${auth.reason}`);

    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  // Read before the plan is parsed, because it decides which of the two
  // things this route does. Absent means the dry run: a caller that forgets
  // the flag gets the safe half.
  const confirm =
    typeof body === "object" && body !== null && (body as { confirm?: unknown }).confirm === true;

  const parsed = ProjectPlanDraftSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "That plan is not a shape this can read.",
        // The field paths, so a model can correct itself rather than guess.
        // No values echoed back - they came from the caller and repeating
        // them adds nothing.
        problems: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const plan = await planProjectService(parsed.data, auth.actor);

    if (!confirm) {
      return NextResponse.json({
        applied: false,
        // Named so a caller cannot mistake a dry run for a write. The
        // commonest way this goes wrong is a model reporting "done" from the
        // response to the first call.
        message: plan.blockers.length > 0
          ? "This plan cannot be applied yet. Nothing was created."
          : "Nothing was created. Send the same plan with confirm: true to create it.",
        plan: summarise(plan),
      });
    }

    if (plan.blockers.length > 0) {
      return NextResponse.json(
        { applied: false, error: "This plan cannot be applied.", plan: summarise(plan) },
        { status: 422 },
      );
    }

    const applied = await applyProjectPlanService(plan, auth.actor);

    return NextResponse.json({
      applied: true,
      projectId: applied.projectId,
      clientCreated: applied.clientCreated,
      counts: {
        phases: applied.phaseCount,
        tasks: applied.taskCount,
        members: applied.memberCount,
      },
      // Repeated on the write, not only on the dry run. Somebody who skipped
      // straight to confirm should still be told what was assumed.
      warnings: plan.warnings,
    });
  } catch (error) {
    const message = isDisplayError(error) ? error.message : MESSAGES.SOMETHING_WENT_WRONG;

    console.error("[POST /api/delivery/project-plan] failed", error);

    return NextResponse.json({ applied: false, error: message }, { status: 400 });
  }
}

// -------------------------------------------------------------------
// What the caller is shown.
//
// THE RESOLVED NAMES, NOT THE IDS. A person reading this in a conversation
// is checking "is that the right client and the right people" - an id
// answers neither question, and a model relaying ids back is how a review
// step becomes a formality.
// -------------------------------------------------------------------
function summarise(plan: Awaited<ReturnType<typeof planProjectService>>) {
  return {
    client:
      plan.client.mode === "existing"
        ? { existing: true, name: plan.client.name }
        : { existing: false, name: plan.client.name },
    project: { title: plan.project.title, isBillable: plan.project.isBillable },
    phases: plan.phases.map((phase) => ({
      name: phase.name,
      tasks: phase.tasks.map((task) => ({
        title: task.title,
        estimateHours: task.estimateHours,
        // Null when the name did not resolve, with the name that was asked
        // for still on it - so a review can say who was missed.
        assignedTo: task.assigneeId ? task.assigneeName : null,
        askedFor: task.assigneeId ? null : task.assigneeName,
      })),
    })),
    members: plan.members.map((member) => ({
      name: member.name,
      isLead: member.isLead,
      addedBecauseAssigned: member.addedForAssignment,
    })),
    totals: plan.totals,
    warnings: plan.warnings,
    blockers: plan.blockers,
  };
}
