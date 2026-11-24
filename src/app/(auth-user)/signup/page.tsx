import { redirect } from "next/navigation";

/**
 * Public guest / shop signup is closed. All new accounts go through
 * company workspace registration (+ package selection).
 */
export default function SignupScreen() {
  redirect("/register-company");
}
