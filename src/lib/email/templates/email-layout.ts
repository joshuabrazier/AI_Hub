import { BRAND, BRAND_COLORS, copyrightLine } from "@/lib/brand";

// -------------------------------------------------------------------
// Shared email layout
//
// HTML emails must use a table-based layout with inline styles to render
// consistently across mail clients (Gmail, Outlook, Apple Mail). This wraps a
// small amount of body content in the product shell: a header band, a white
// card, an optional details panel, a call-to-action button, and a footer.
//
// The palette below mirrors the tokens in globals.css. Email cannot read CSS
// custom properties, so the values are duplicated here by necessity - if you
// re-tone the app, re-tone this too or every outgoing email keeps the old look
// with nothing to warn you.
// -------------------------------------------------------------------

// Brand palette mirrors the hex values in globals.css (emails can't use the
// oklch CSS variables, so the colours are duplicated here as hex).
const PALETTE = {
  primary: BRAND_COLORS.primary,
  surface: BRAND_COLORS.surface,
  line: BRAND_COLORS.line,
  ink: BRAND_COLORS.ink,
  muted: BRAND_COLORS.muted,
  white: BRAND_COLORS.white,
};

// The default header band and button colour. Templates may override it via
// EmailLayoutOptions.accent, but almost none should need to.
export const EMAIL_ACCENT = PALETTE.primary;

const FONT_STACK = "'Segoe UI', Roboto, Oxygen, Ubuntu, Helvetica, Arial, sans-serif";

// Escape any value that comes from user/DB data before it goes into the HTML.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type EmailInfoRow = { label: string; value: string };
export type EmailButton = { label: string; url: string };

export type EmailLayoutOptions = {
  // Hidden text shown as the inbox preview line
  preheader: string;
  // Header band + button colour (defaults to brand teal)
  accent?: string;
  heading: string;
  intro: string;
  // Optional pre-sanitised rich-text HTML, inserted verbatim after the intro.
  // The caller MUST have already run this through sanitizeRichText - it is the
  // one slot in this layout that is not escaped (used for notification bodies).
  bodyHtml?: string;
  // Optional "label / value" details panel (e.g. who invited you)
  info?: EmailInfoRow[];
  // Whether the details panel sits before (default) or after the button
  infoPosition?: "before" | "after";
  // Optional call-to-action button
  button?: EmailButton;
  // Optional muted note under the button (e.g. "didn't request this?")
  note?: string;
};

export function renderEmailLayout(options: EmailLayoutOptions): string {
  const accent = options.accent ?? PALETTE.primary;

  const infoPanel = options.info?.length
    ? `
              <tr>
                <td style="padding: 8px 0 4px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PALETTE.surface}; border-radius:12px;">
                    <tr>
                      <td style="padding: 8px 22px;">
                        ${options.info
                          .map(
                            (row) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                          <tr>
                            <td style="font-family:${FONT_STACK}; font-size:13px; color:${PALETTE.muted}; padding:6px 0;">${escapeHtml(row.label)}</td>
                            <td align="right" style="font-family:${FONT_STACK}; font-size:14px; font-weight:600; color:${PALETTE.primary}; padding:6px 0;">${escapeHtml(row.value)}</td>
                          </tr>
                        </table>`,
                          )
                          .join("")}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>`
    : "";

  const button = options.button
    ? `
              <tr>
                <td align="center" style="padding: 26px 0 6px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                    <tr>
                      <td align="center" bgcolor="${accent}" style="border-radius:12px;">
                        <a href="${options.button.url}" target="_blank" style="display:inline-block; padding:15px 38px; font-family:${FONT_STACK}; font-size:16px; font-weight:700; color:${PALETTE.white}; text-decoration:none; border-radius:12px;">${escapeHtml(options.button.label)}</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td align="center" style="padding: 12px 0 4px; font-family:${FONT_STACK}; font-size:12px; line-height:18px; color:${PALETTE.muted}; word-break:break-all;">
                  Button not working? Copy and paste this link into your browser:<br>
                  <a href="${options.button.url}" target="_blank" style="color:${accent};">${escapeHtml(options.button.url)}</a>
                </td>
              </tr>`
    : "";

  const note = options.note
    ? `
              <tr>
                <td style="padding: 18px 0 4px; font-family:${FONT_STACK}; font-size:13px; line-height:20px; color:${PALETTE.muted};">${escapeHtml(options.note)}</td>
              </tr>`
    : "";

  // Pre-sanitised HTML - intentionally NOT escaped (see bodyHtml doc above).
  const bodyBlock = options.bodyHtml
    ? `
              <tr>
                <td style="font-family:${FONT_STACK}; font-size:15px; line-height:24px; color:${PALETTE.ink}; padding: 4px 0 2px;">${options.bodyHtml}</td>
              </tr>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
</head>
<body style="margin:0; padding:0; background:${PALETTE.surface}; -webkit-font-smoothing:antialiased;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${escapeHtml(options.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PALETTE.surface};">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%; max-width:600px; background:${PALETTE.white}; border-radius:20px; overflow:hidden; border:1px solid ${PALETTE.line};">
          <!-- Header -->
          <tr>
            <td align="center" style="background:${accent}; padding: 24px;">
              <div style="font-family:${FONT_STACK}; font-size:14px; letter-spacing:3px; font-weight:700; color:${PALETTE.white}; text-transform:uppercase;">${escapeHtml(BRAND.name)}</div>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 34px 34px 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-family:${FONT_STACK}; font-size:23px; font-weight:700; color:${PALETTE.primary}; padding-bottom:12px;">${escapeHtml(options.heading)}</td>
                </tr>
                <tr>
                  <td style="font-family:${FONT_STACK}; font-size:15px; line-height:24px; color:${PALETTE.ink}; padding-bottom:6px;">${escapeHtml(options.intro)}</td>
                </tr>
                ${bodyBlock}
                ${options.infoPosition === "after" ? "" : infoPanel}
                ${button}
                ${options.infoPosition === "after" ? infoPanel : ""}
                ${note}
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" style="padding: 26px 24px 30px; border-top:1px solid ${PALETTE.line};">
              <div style="font-family:${FONT_STACK}; font-size:15px; font-weight:700; color:${PALETTE.primary}; letter-spacing:0.5px;">${escapeHtml(BRAND.name)}</div>
              <div style="font-family:${FONT_STACK}; font-size:12px; color:${PALETTE.muted}; padding-top:6px; line-height:18px;">This is an automated message. Please do not reply directly.</div>
              <div style="font-family:${FONT_STACK}; font-size:11px; color:${PALETTE.muted}; padding-top:10px;">${escapeHtml(copyrightLine())}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
