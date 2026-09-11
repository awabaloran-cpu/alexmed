import { DrizzleAdapter } from "@auth/drizzle-adapter";
import bcrypt from "bcryptjs";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import {
  accounts,
  sessions,
  users,
  verificationTokens,
} from "../drizzle/schema";
import { getUserByEmail, requireDb, touchLastSignedIn } from "./db";

// Distinct error code (rather than the generic "CredentialsSignin" from
// returning null) so LoginForm can show "حسابك معلّق" instead of "بيانات
// الدخول غير صحيحة" — a suspended student didn't mistype their password.
class AccountSuspendedError extends CredentialsSignin {
  code = "account_suspended";
}

// Google only appears once real credentials are supplied — keeps this app
// fully functional on Credentials alone until then, no code change needed
// later beyond dropping the two env vars in.
const googleEnabled = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Adapter persists users/accounts (so a Google sign-in creates/links a real
  // `users` row) even though sessions themselves stay JWT-based below — the
  // adapter's own session/verificationToken tables just go unused at runtime.
  adapter: DrizzleAdapter(requireDb(), {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "jwt" },
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email =
          typeof credentials?.email === "string"
            ? credentials.email.toLowerCase().trim()
            : "";
        const password =
          typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;

        const user = await getUserByEmail(email);
        if (!user) return null;
        // Google-only accounts have no password to compare against.
        if (!user.passwordHash) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        if (user.suspendedAt) throw new AccountSuspendedError();

        await touchLastSignedIn(user.id);

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          role: user.role,
        };
      },
    }),
    ...(googleEnabled
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          }),
        ]
      : []),
  ],
  callbacks: {
    // Credentials' authorize() already blocks a suspended account before it
    // ever returns a user, so this only matters for the Google path (which
    // never runs authorize()). Returning a URL redirects there with that
    // query string instead of the default generic "?error=AccessDenied".
    async signIn({ user, account }) {
      if (account?.provider !== "google" || !user.email) return true;
      const existing = await getUserByEmail(user.email);
      if (existing?.suspendedAt) {
        return "/login?error=account_suspended";
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as { id: string }).id;
        token.role = (user as { role?: string }).role ?? "user";
      } else if (token.id && !token.role) {
        // Returning session for a user created via the adapter (e.g. first
        // Google sign-in) won't have `role` on the initial `user` object from
        // some provider flows — default it the same way the schema does.
        token.role = "user";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as typeof session.user & { role: string }).role =
          (token.role as string) ?? "user";
      }
      return session;
    },
  },
});

export { googleEnabled };
