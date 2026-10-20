import { LocalAccountButton } from "@/components/local-account-button";
import type { CharacterMode } from "@/lib/hellraiser";

type Props = { theme: CharacterMode; onTheme: (t: CharacterMode) => void };

/** Sign-in and sync run on your own server (see LocalAccountButton). The old Lovable Cloud Google sign-in was removed. */
export function AccountButton(props: Props) {
  return <LocalAccountButton {...props} />;
}
