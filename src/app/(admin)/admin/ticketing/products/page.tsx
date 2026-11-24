import { redirect } from 'next/navigation';

/** Alias — ticket products list is `/admin/ticketing`. */
export default function AdminTicketingProductsAlias() {
  redirect('/admin/ticketing');
}
