import { api, unwrap, type MaybeWrapped } from "@/utils/api";

export type RoleTemplate = {
  _id: string;
  orgId: string;
  name: string;
  description: string;
  permissions: string[];
  createdBy: string | null;
  createdByName?: string | null;
  updatedBy?: string | null;
  updatedByName?: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

const BASE = "/api/admin/role-templates";

export async function listRoleTemplates(): Promise<{
  templates: RoleTemplate[];
  orgId: string;
}> {
  const raw = await api<MaybeWrapped<{ templates: RoleTemplate[]; orgId: string }>>(
    BASE,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  return {
    templates: Array.isArray(data?.templates) ? data.templates : [],
    orgId: data?.orgId ? String(data.orgId) : "",
  };
}

export async function createRoleTemplate(payload: {
  name: string;
  description?: string;
  permissions: string[];
}): Promise<RoleTemplate> {
  const raw = await api<MaybeWrapped<{ template: RoleTemplate }>>(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include",
  });
  const data = unwrap(raw);
  if (!data?.template) throw new Error("Failed to create role template");
  return data.template;
}

export async function updateRoleTemplate(
  id: string,
  payload: {
    name?: string;
    description?: string;
    permissions?: string[];
  }
): Promise<{ template: RoleTemplate; invalidatedAssigneeIds: string[] }> {
  const raw = await api<
    MaybeWrapped<{
      template: RoleTemplate;
      invalidatedAssigneeIds?: string[];
    }>
  >(`${BASE}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include",
  });
  const data = unwrap(raw);
  if (!data?.template) throw new Error("Failed to update role template");
  return {
    template: data.template,
    invalidatedAssigneeIds: data.invalidatedAssigneeIds ?? [],
  };
}

export async function deleteRoleTemplate(id: string): Promise<void> {
  await api(`${BASE}/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
}
