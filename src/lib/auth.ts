import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { verifyPassword } from "@/lib/password";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Private account",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
        const passwordHash = process.env.OWNER_PASSWORD_HASH;
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;

        if (
          !ownerEmail ||
          !passwordHash ||
          !email ||
          !password ||
          email.length > 320 ||
          password.length > 1_024 ||
          email !== ownerEmail ||
          !verifyPassword(password, passwordHash)
        ) {
          return null;
        }

        return { id: ownerEmail, email: ownerEmail };
      },
    }),
  ],
  pages: { signIn: "/login" },
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 12,
  },
  callbacks: {
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
