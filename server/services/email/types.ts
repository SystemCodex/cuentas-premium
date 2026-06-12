export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
};
