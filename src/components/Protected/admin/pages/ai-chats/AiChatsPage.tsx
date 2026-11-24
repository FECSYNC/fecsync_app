'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { formatActiveProviderSummary, isAssistantConfigured } from '@/services/aiSettings';
import { useAdminAiSettingsQuery } from '@/hooks/useAiSettings';
import { useCatalogActionPermissions } from '@/hooks/useAdminPermission';
import {
  FASHION_CHAT_PAGE_SIZE,
  useAdminFashionChatQuery,
  useAdminFashionChatsQuery,
  useBulkDeleteFashionChatsMutation,
  useDeleteFashionChatMutation,
  usePatchFashionChatMutation,
  useReplyFashionChatMutation,
} from '@/hooks/useAdminFashionChats';
import { useToast } from '@/contexts/toast-context';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import FashionMessageContent from '@/components/common/FashionMessageContent';
import { ApiError } from '@/utils/api';
import {
  FASHION_CHAT_SECURITY_CODE,
  FASHION_CHAT_SECURITY_RATE_CODE,
  scanFashionChatMessageForStaff,
  sanitizeFashionChatImageSrc,
} from '@/lib/fashionChatSecurity';

function formatWhen(value?: string) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return '—';
  }
}

export default function AiChatsPage() {
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canManageAi = can(P.AiManage);
  const aiSettings = useAdminAiSettingsQuery(canManageAi);
  const { canReadAiChats, canReplyAiChats, canDeleteAiChats } =
    useCatalogActionPermissions();
  const [handoffOnly, setHandoffOnly] = useState(false);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [reply, setReply] = useState('');
  const [page, setPage] = useState(1);
  const [deletingDetailId, setDeletingDetailId] = useState<string | null>(null);

  const filters = useMemo(() => {
    const next: {
      handoff?: boolean;
      status?: string;
      q?: string;
      page: number;
      limit: number;
    } = {
      page,
      limit: FASHION_CHAT_PAGE_SIZE,
    };
    if (handoffOnly) next.handoff = true;
    if (status) next.status = status;
    if (search) next.q = search;
    return next;
  }, [handoffOnly, status, search, page]);

  const listQuery = useAdminFashionChatsQuery(canReadAiChats, filters);
  const detailQuery = useAdminFashionChatQuery(
    selectedId,
    canReadAiChats &&
      Boolean(selectedId) &&
      deletingDetailId !== selectedId
  );
  const replyMutation = useReplyFashionChatMutation();
  const patchMutation = usePatchFashionChatMutation();
  const deleteMutation = useDeleteFashionChatMutation();
  const bulkDeleteMutation = useBulkDeleteFashionChatsMutation();

  const chats = listQuery.data?.chats || [];
  const stats = listQuery.data?.stats;
  const selected = detailQuery.data;
  const listLoading = listQuery.isPending && !listQuery.data;
  const totalPages = Math.max(stats?.totalPages ?? 1, 1);
  const total = stats?.total ?? 0;
  const currentPage = Math.min(stats?.page ?? page, totalPages);
  const pageIds = chats.map((c) => c.id);
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
  const deleting =
    deleteMutation.isPending || bulkDeleteMutation.isPending;

  // After list consolidation/merge, the selected id may no longer exist.
  useEffect(() => {
    if (!selectedId) return;
    if (chats.some((c) => c.id === selectedId)) return;
    if (chats.length > 0) {
      setSelectedId(chats[0].id);
      return;
    }
    setSelectedId(null);
    setReply('');
  }, [chats, selectedId]);

  useEffect(() => {
    if (!selectedId || !detailQuery.isError) return;
    const err = detailQuery.error;
    if (!(err instanceof ApiError) || err.status !== 404) return;
    void listQuery.refetch().then((result) => {
      const next = result.data?.chats || [];
      if (next.some((c) => c.id === selectedId)) return;
      if (next.length > 0) {
        setSelectedId(next[0].id);
      } else {
        setSelectedId(null);
        setReply('');
      }
    });
  }, [detailQuery.isError, detailQuery.error, selectedId, listQuery]);

  const applySearch = () => {
    setPage(1);
    setSearch(q.trim());
    setSelectedIds([]);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAllPage = () => {
    if (allPageSelected) {
      setSelectedIds((prev) => prev.filter((id) => !pageIds.includes(id)));
      return;
    }
    setSelectedIds((prev) => [...new Set([...prev, ...pageIds])]);
  };

  const handleDeleteOne = async (id: string, label?: string) => {
    if (!canDeleteAiChats) {
      addToast('You need ai:chats_delete to delete conversations', 'error');
      return;
    }
    const name = label || 'this conversation';
    if (
      !window.confirm(
        `Permanently delete ${name}? This removes it from the database and cannot be undone.`
      )
    ) {
      return;
    }
    try {
      setDeletingDetailId(id);
      if (selectedId === id) {
        setSelectedId(null);
        setReply('');
      }
      setSelectedIds((prev) => prev.filter((x) => x !== id));
      await deleteMutation.mutateAsync(id);
      addToast('Conversation deleted', 'success');
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to delete conversation',
        'error'
      );
    } finally {
      setDeletingDetailId(null);
    }
  };

  const handleBulkDelete = async () => {
    if (!canDeleteAiChats) {
      addToast('You need ai:chats_delete to delete conversations', 'error');
      return;
    }
    if (selectedIds.length === 0) return;
    if (
      !window.confirm(
        `Permanently delete ${selectedIds.length} conversation${
          selectedIds.length === 1 ? '' : 's'
        }? This removes them from the database and cannot be undone.`
      )
    ) {
      return;
    }
    try {
      const idsToDelete = [...selectedIds];
      if (selectedId && idsToDelete.includes(selectedId)) {
        setDeletingDetailId(selectedId);
        setSelectedId(null);
        setReply('');
      }
      setSelectedIds([]);
      const result = await bulkDeleteMutation.mutateAsync(idsToDelete);
      addToast(
        `Deleted ${result.deletedCount} conversation${
          result.deletedCount === 1 ? '' : 's'
        }`,
        'success'
      );
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to delete conversations',
        'error'
      );
    } finally {
      setDeletingDetailId(null);
    }
  };

  const handleReply = async () => {
    if (!selectedId || !reply.trim()) return;
    if (!canReplyAiChats) {
      addToast('You need ai:chats_reply to reply', 'error');
      return;
    }
    const preflight = scanFashionChatMessageForStaff({ content: reply.trim() });
    if (!preflight.allowed) {
      addToast(preflight.reason, 'error');
      return;
    }
    try {
      await replyMutation.mutateAsync({
        id: selectedId,
        content: preflight.content,
      });
      setReply('');
      addToast('Reply sent to customer', 'success');
    } catch (err) {
      if (err instanceof ApiError) {
        const code = (err.payload as { code?: string } | undefined)?.code;
        if (code === FASHION_CHAT_SECURITY_RATE_CODE) {
          addToast(err.message, 'error');
          return;
        }
        if (code === FASHION_CHAT_SECURITY_CODE) {
          addToast(err.message, 'error');
          return;
        }
      }
      addToast(err instanceof Error ? err.message : 'Failed to reply', 'error');
    }
  };

  const handleResolve = async () => {
    if (!selectedId || !canReplyAiChats) return;
    try {
      await patchMutation.mutateAsync({
        id: selectedId,
        patch: { status: 'resolved', handoffRequired: false },
      });
      addToast('Chat marked resolved', 'success');
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to update chat',
        'error'
      );
    }
  };

  if (!canReadAiChats) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        You need the <strong>View AI Conversations</strong> permission to open
        this inbox.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">AI Chats</h1>
        <p className="text-gray-600 mt-1">
          Customer StyleForge conversations, contact details, handoffs, and
          staff replies. Open from the <strong>AI Chats</strong> menu.
        </p>
      </div>

      {canManageAi && aiSettings.data && !isAssistantConfigured(aiSettings.data) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          The storefront assistant is not fully configured yet. Open{' '}
          <Link href="/admin/ai-settings" className="font-semibold underline">
            Assistant settings
          </Link>{' '}
          {aiSettings.data.followsServerEnv
            ? 'and add OPENROUTER_API_KEY to server env, or move the setup to the dashboard.'
            : aiSettings.data.envImportAvailable
              ? 'and click Move current setup to dashboard, or paste your API key and save.'
              : 'to paste your API key and save.'}
        </div>
      )}

      {canManageAi && (
        <div className="rounded-xl border border-[#D4AF37]/25 bg-[#D4AF37]/5 px-4 py-3 text-sm text-gray-700 flex flex-wrap items-center justify-between gap-3">
          <span>
            Storefront assistant:{' '}
            <strong>
              {aiSettings.isLoading
                ? '…'
                : aiSettings.data?.botName || 'StyleForge AI'}
            </strong>
            {!aiSettings.isLoading && !aiSettings.isError && (
              <>
                {' '}
                · {formatActiveProviderSummary(aiSettings.data)}
              </>
            )}
          </span>
          <Link
            href="/admin/ai-settings"
            className="font-semibold text-[#8B6914] hover:text-[#6B5010] whitespace-nowrap"
          >
            Assistant settings →
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500">Handoffs waiting</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {stats?.handoffCount ?? '—'}
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500">Waiting on staff</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {stats?.waitingCount ?? '—'}
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500">Total conversations</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {stats?.total ?? '—'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs text-gray-600 mb-1">Search</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applySearch()}
            placeholder="Name, email, phone…"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
        </div>
        <button
          type="button"
          onClick={applySearch}
          className="px-4 py-2 rounded-lg bg-[#D4AF37] text-gray-900 text-sm font-medium"
        >
          Search
        </button>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Status</label>
          <select
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
              setSelectedIds([]);
            }}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
          >
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="waiting_staff">Waiting staff</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-gray-700 pb-2">
          <input
            type="checkbox"
            checked={handoffOnly}
            onChange={(e) => {
              setPage(1);
              setHandoffOnly(e.target.checked);
              setSelectedIds([]);
            }}
          />
          Handoffs only
        </label>
      </div>

      {canDeleteAiChats && selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-900">
            {selectedIds.length} conversation
            {selectedIds.length === 1 ? '' : 's'} selected
          </p>
          <button
            type="button"
            onClick={handleBulkDelete}
            disabled={deleting}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-60"
          >
            {bulkDeleteMutation.isPending && <ButtonSpinner />}
            <Trash2 className="w-4 h-4" />
            Delete selected
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 min-h-[480px]">
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-lg overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-gray-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {canDeleteAiChats && chats.length > 0 && (
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={toggleSelectAllPage}
                  aria-label="Select all conversations on this page"
                  className="rounded border-gray-300"
                />
              )}
              <span>Conversations</span>
            </div>
            {total > 0 && (
              <span className="text-xs font-normal text-gray-500">
                Page {currentPage} of {totalPages}
              </span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {listLoading ? (
              <div className="p-3 space-y-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-14 rounded-lg bg-gray-100 animate-pulse"
                  />
                ))}
              </div>
            ) : chats.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">No chats yet.</p>
            ) : (
              chats.map((chat) => {
                const isChecked = selectedIds.includes(chat.id);
                return (
                  <div
                    key={chat.id}
                    className={`flex items-start gap-2 px-3 py-3 border-b border-gray-50 hover:bg-[#D4AF37]/5 ${
                      selectedId === chat.id ? 'bg-[#D4AF37]/10' : ''
                    }`}
                  >
                    {canDeleteAiChats && (
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelect(chat.id)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select conversation with ${
                          chat.contact?.name || 'unknown customer'
                        }`}
                        className="mt-1 rounded border-gray-300"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedId(chat.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {chat.contact?.name || 'Unknown customer'}
                          </p>
                          <p className="text-xs text-gray-500 truncate">
                            {chat.contact?.email || 'No email'}
                          </p>
                          {chat.contact?.phone ? (
                            <p className="text-xs text-gray-400 truncate">
                              {chat.contact.phone}
                            </p>
                          ) : null}
                        </div>
                        {chat.handoffRequired && (
                          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">
                            Handoff
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                        {chat.preview || '—'}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-1">
                        {formatWhen(chat.lastMessageAt)} · {chat.status}
                        {chat.updatedByName
                          ? ` · Updated by ${chat.updatedByName}`
                          : ''}
                      </p>
                    </button>
                    {canDeleteAiChats && (
                      <button
                        type="button"
                        title="Delete conversation"
                        aria-label="Delete conversation"
                        disabled={deleting}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteOne(
                            chat.id,
                            chat.contact?.name
                              ? `"${chat.contact.name}"`
                              : 'this conversation'
                          );
                        }}
                        className="mt-0.5 p-1.5 rounded-md text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
          {totalPages > 1 && (
            <div className="px-3 py-2 border-t border-gray-100 flex items-center justify-between gap-2">
              <button
                type="button"
                disabled={currentPage <= 1 || listQuery.isFetching}
                onClick={() => {
                  setSelectedIds([]);
                  setPage((p) => Math.max(1, p - 1));
                }}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-[11px] text-gray-500">
                {Math.min((currentPage - 1) * FASHION_CHAT_PAGE_SIZE + 1, total)}–
                {Math.min(currentPage * FASHION_CHAT_PAGE_SIZE, total)} of{' '}
                {total}
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages || listQuery.isFetching}
                onClick={() => {
                  setSelectedIds([]);
                  setPage((p) => Math.min(totalPages, p + 1));
                }}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          )}
        </div>

        <div className="lg:col-span-3 bg-white border border-gray-200 rounded-lg flex flex-col overflow-hidden">
          {!selectedId ? (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-500 p-6">
              Select a conversation to view history and reply.
            </div>
          ) : detailQuery.isLoading || !selected ? (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-500">
              Loading conversation…
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900">
                    {selected.contact?.name || 'Unknown customer'}
                  </p>
                  <p className="text-xs text-gray-600">
                    {selected.contact?.email || 'No email'}
                    {selected.contact?.phone
                      ? ` · ${selected.contact.phone}`
                      : ''}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-1">
                    Status: {selected.status}
                    {selected.createdAt
                      ? ` · Created ${new Date(selected.createdAt).toLocaleString()}`
                      : ''}
                    {selected.updatedByName ? (
                      <span className="text-gray-500 font-normal">
                        {' '}
                        · Updated by {selected.updatedByName}
                        {selected.updatedAt
                          ? ` · ${new Date(selected.updatedAt).toLocaleString()}`
                          : ''}
                      </span>
                    ) : selected.updatedAt ? (
                      <span className="text-gray-500 font-normal">
                        {' '}
                        · Updated {new Date(selected.updatedAt).toLocaleString()}
                      </span>
                    ) : null}
                    {selected.handoffRequired ? ' · needs handoff' : ''}
                    {selected.messages?.length
                      ? ` · ${selected.messages.length} messages`
                      : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canReplyAiChats && selected.status !== 'resolved' && (
                    <button
                      type="button"
                      onClick={handleResolve}
                      disabled={patchMutation.isPending}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50"
                    >
                      Mark resolved
                    </button>
                  )}
                  {canDeleteAiChats && (
                    <button
                      type="button"
                      onClick={() =>
                        void handleDeleteOne(
                          selected.id,
                          selected.contact?.name
                            ? `"${selected.contact.name}"`
                            : 'this conversation'
                        )
                      }
                      disabled={deleting}
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-60"
                    >
                      {deleteMutation.isPending && <ButtonSpinner />}
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
                {selected.messages.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-8">
                    No messages in this conversation yet.
                  </p>
                ) : (
                  selected.messages.map((m, idx) => {
                    const safeImageSrc = m.image
                      ? sanitizeFashionChatImageSrc(m.image)
                      : null;
                    return (
                    <div
                      key={m.id || idx}
                      className={`max-w-[90%] rounded-xl px-3 py-2 text-sm ${
                        m.role === 'user'
                          ? 'ml-auto bg-[#D4AF37] text-white'
                          : m.role === 'staff'
                            ? 'bg-emerald-50 border border-emerald-100 text-gray-900'
                            : 'bg-white border border-gray-100 text-gray-900'
                      }`}
                    >
                      <p className="text-[10px] uppercase tracking-wide opacity-70 mb-0.5">
                        {m.role === 'staff'
                          ? m.staffName || 'Staff'
                          : m.role === 'user'
                            ? 'Customer'
                            : 'AI'}
                      </p>
                      {safeImageSrc ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={safeImageSrc}
                          alt="Customer upload"
                          className="mb-2 max-h-40 rounded-lg object-cover"
                        />
                      ) : null}
                      <FashionMessageContent
                        content={m.content || ''}
                        compact
                      />
                    </div>
                    );
                  })
                )}
              </div>

              <div className="p-4 border-t border-gray-100 space-y-2">
                {!canReplyAiChats ? (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    You can view chats. Replying requires{' '}
                    <strong>Reply to AI Conversations</strong> (
                    <code>ai:chats_reply</code>).
                  </p>
                ) : selected.status === 'resolved' ? (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      This chat is <strong>resolved</strong>. Reopen it to send
                      another reply to the customer.
                    </p>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await patchMutation.mutateAsync({
                            id: selected.id,
                            patch: { status: 'open' },
                          });
                          addToast('Chat reopened', 'success');
                        } catch (err) {
                          addToast(
                            err instanceof Error
                              ? err.message
                              : 'Failed to reopen chat',
                            'error'
                          );
                        }
                      }}
                      disabled={patchMutation.isPending}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50"
                    >
                      Reopen chat
                    </button>
                  </div>
                ) : (
                  <>
                    <textarea
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      rows={3}
                      placeholder="Write a reply to the customer…"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40"
                    />
                    <button
                      type="button"
                      onClick={handleReply}
                      disabled={!reply.trim() || replyMutation.isPending}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#D4AF37] text-gray-900 text-sm font-semibold disabled:opacity-60"
                    >
                      {replyMutation.isPending && <ButtonSpinner />}
                      Send reply
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
