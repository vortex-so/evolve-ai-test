import { notFound } from "next/navigation";

import { fetchAdminResponse } from "@/lib/admin-server";
import { normalizeAdminUserDetailResponse } from "@/lib/admin-types";

import { UserDetail } from "./user-detail";

export const dynamic = "force-dynamic";

type UserDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function UserDetailPage({ params }: UserDetailPageProps) {
  const { id } = await params;
  const response = await fetchAdminResponse(`/api/admin/users/${id}`);

  if (response.status === 404) {
    notFound();
  }

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  const user = normalizeAdminUserDetailResponse(await response.json());
  return <UserDetail user={user} />;
}
