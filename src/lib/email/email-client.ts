import { EmailClient } from "@azure/communication-email";
import { AzureKeyCredential } from "@azure/core-auth";
import { envServer } from "../env-server";

// -------------------------------------------------------------------
// Azure Communication Services email client
// -------------------------------------------------------------------
let emailClient: EmailClient | undefined;

export function getEmailClient(): EmailClient {
  if (!envServer.EMAIL_AZURE_ENDPOINT || !envServer.EMAIL_AZURE_ACCESS_KEY) {
    throw new Error("EMAIL_AZURE_ENDPOINT and EMAIL_AZURE_ACCESS_KEY are required to send email");
  }

  if (!emailClient) {
    emailClient = new EmailClient(
      envServer.EMAIL_AZURE_ENDPOINT,
      new AzureKeyCredential(envServer.EMAIL_AZURE_ACCESS_KEY),
    );
  }

  return emailClient;
}
