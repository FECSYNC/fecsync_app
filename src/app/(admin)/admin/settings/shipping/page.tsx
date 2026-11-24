import { redirect } from "next/navigation";

/** Prompt alias — canonical page is /admin/shipping-settings. */
export default function AdminSettingsShippingAlias() {
  redirect("/admin/shipping-settings");
}
