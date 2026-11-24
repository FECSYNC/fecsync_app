// src/hooks/useFashionChat.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  sendFashionConsultation,
  getChatHistory,
  type ChatMessage,
  type SendMessageResponse,
  type FashionChatInput,
} from '@/services/fashionChat';
import { scanFashionChatMessage } from '@/lib/fashionChatSecurity';

/** ---------- Query Keys ---------- */
export const fashionChatKeys = {
  all: ['fashionChat'] as const,
  history: (sessionId?: string) =>
    [...fashionChatKeys.all, 'history', sessionId || ''] as const,
};

/** ---------- Hooks ---------- */

/**
 * Hook to fetch chat history for a storefront session.
 * Cache cleared on logout via clearUserQueries(['fashionChat']).
 */
export function useChatHistoryQuery(sessionId?: string) {
  return useQuery({
    queryKey: fashionChatKeys.history(sessionId),
    queryFn: async () => {
      const result = await getChatHistory(sessionId);
      return result.messages;
    },
    enabled: Boolean(sessionId),
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });
}

/**
 * Hook to send a fashion consultation request (non-streaming).
 * Prefer ChatWindow + streamFashionConsultation for the live UI.
 */
export function useSendConsultationMutation(sessionId?: string) {
  const queryClient = useQueryClient();
  const key = fashionChatKeys.history(sessionId);

  return useMutation({
    mutationFn: (input: FashionChatInput) => {
      const content =
        input.message?.trim() ||
        (input.messages && input.messages.length > 0
          ? input.messages[input.messages.length - 1].content
          : '') ||
        (input.image ? 'Please analyze this outfit image.' : '');
      const scan = scanFashionChatMessage({
        content,
        image: input.image,
      });
      if (!scan.allowed) {
        throw new Error(scan.reason);
      }
      return sendFashionConsultation({
        ...input,
        message: scan.content,
        image: scan.image,
      });
    },
    onMutate: async (input: FashionChatInput) => {
      await queryClient.cancelQueries({ queryKey: key });

      const previousHistory = queryClient.getQueryData<ChatMessage[]>(key);

      const content =
        input.message?.trim() ||
        (input.messages && input.messages.length > 0
          ? input.messages[input.messages.length - 1].content
          : '') ||
        'Fashion consultation request';

      const optimisticUserMessage: ChatMessage = {
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
      };

      queryClient.setQueryData<ChatMessage[]>(key, (old = []) => [
        ...old,
        optimisticUserMessage,
      ]);

      return { previousHistory };
    },
    onSuccess: (data: SendMessageResponse) => {
      if (data.chat && Array.isArray(data.chat.messages)) {
        queryClient.setQueryData<ChatMessage[]>(key, data.chat.messages);
      } else {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
    onError: (_error, _input, context) => {
      if (context?.previousHistory) {
        queryClient.setQueryData(key, context.previousHistory);
      }
    },
  });
}
