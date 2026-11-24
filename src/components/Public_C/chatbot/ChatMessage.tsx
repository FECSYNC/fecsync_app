'use client';

import React from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { Bot, User, Headphones } from 'lucide-react';
import type { ChatMessage as ChatMessageType } from '@/services/fashionChat';
import { getProductById } from '@/services/products';
import FashionMessageContent from '@/components/common/FashionMessageContent';
import { sanitizeFashionChatImageSrc } from '@/lib/fashionChatSecurity';

interface ChatMessageProps {
  message: ChatMessageType;
}

function PrefetchProductLinks({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const onInteract = (e: React.MouseEvent | React.FocusEvent) => {
    const target = e.target as HTMLElement | null;
    const anchor = target?.closest?.('a[href^="/shop/"]') as HTMLAnchorElement | null;
    if (!anchor) return;
    const productId = anchor.getAttribute('href')?.replace(/^\/shop\//, '').split(/[?#]/)[0];
    if (!productId) return;
    void queryClient.prefetchQuery({
      queryKey: ['product', productId],
      queryFn: () => getProductById(productId),
      staleTime: 30 * 1000,
    });
  };

  return (
    <div onMouseOver={onInteract} onFocus={onInteract}>
      {children}
    </div>
  );
}

const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isUser = message.role === 'user';
  const isStaff = message.role === 'staff';
  const timestamp = message.timestamp || message.createdAt;
  const safeImageSrc = message.image
    ? sanitizeFashionChatImageSrc(message.image)
    : null;

  const formatTime = (time?: string) => {
    if (!time) return '';
    const date = new Date(time);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div
      className={`flex gap-3 mb-4 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
    >
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
          isUser
            ? 'bg-[#D4AF37]'
            : isStaff
              ? 'bg-emerald-600'
              : 'bg-gray-200'
        }`}
      >
        {isUser ? (
          <User className="w-5 h-5 text-white" />
        ) : isStaff ? (
          <Headphones className="w-4 h-4 text-white" />
        ) : (
          <Bot className="w-5 h-5 text-gray-700" />
        )}
      </div>

      <div
        className={`flex flex-col max-w-[75%] overflow-hidden ${
          isUser ? 'items-end' : 'items-start'
        }`}
      >
        {isStaff && (
          <span className="text-[10px] font-medium text-emerald-700 mb-0.5 px-1">
            {message.staffName || 'Style consultant'}
          </span>
        )}
        <div
          className={`px-4 py-2.5 rounded-2xl ${
            isUser
              ? 'bg-[#D4AF37] text-white rounded-tr-sm'
              : isStaff
                ? 'bg-emerald-50 text-gray-900 border border-emerald-100 rounded-tl-sm'
                : 'bg-gray-100 text-gray-900 rounded-tl-sm'
          }`}
        >
          {safeImageSrc && (
            <div className="mb-2">
              <img
                src={safeImageSrc}
                alt="Shared image"
                className="max-w-full h-auto rounded-lg border border-white/20 shadow-sm"
                style={{ maxHeight: '200px' }}
              />
            </div>
          )}
          <PrefetchProductLinks>
            <FashionMessageContent content={message.content || ''} />
          </PrefetchProductLinks>
          {message.streaming && (
            <span
              className="inline-block w-1.5 h-3.5 ml-0.5 align-middle bg-[#D4AF37] animate-pulse"
              aria-hidden
            />
          )}
        </div>

        {timestamp && (
          <span className="text-xs text-gray-500 mt-1 px-1">
            {formatTime(timestamp)}
          </span>
        )}
      </div>
    </div>
  );
};

export default ChatMessage;
