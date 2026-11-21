import { redirect } from "next/navigation";

/** "Emergency Contacts" lives inside the Trusted Emergency Circle page. */
export default function ContactsRedirect() {
  redirect("/circle");
}
