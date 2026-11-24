import { redirect } from 'next/navigation';

/** List lives on the profile tab; keep URL for deep-links. */
export default function ProfileTailoringJobsPage() {
  redirect('/profile?tab=tailoring-jobs');
}
