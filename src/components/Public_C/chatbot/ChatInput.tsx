import React, { useState, KeyboardEvent, useRef } from 'react';
import { Send, Image as ImageIcon, X } from 'lucide-react';
import {
  FASHION_CHAT_MAX_IMAGE_BYTES,
  validateFashionChatImage,
} from '@/lib/fashionChatSecurity';

interface ChatInputProps {
    onSend: (message: string, image?: string) => void;
    disabled?: boolean;
    readOnly?: boolean;
    hideHint?: boolean;
    placeholder?: string;
}

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const ChatInput: React.FC<ChatInputProps> = ({
    onSend,
    disabled = false,
    readOnly = false,
    hideHint = false,
    placeholder = "Type your message..."
}) => {
    const [message, setMessage] = useState('');
    const [image, setImage] = useState<string | null>(null);
    const [imageError, setImageError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleSend = () => {
        const trimmedMessage = message.trim();
        if ((trimmedMessage || image) && !disabled) {
            onSend(trimmedMessage, image || undefined);
            setMessage('');
            setImage(null);
            setImageError(null);
        }
    };

    const handleKeyPress = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
            setImage(null);
            setImageError('Use JPEG, PNG, WebP, or GIF images only.');
            return;
        }
        if (file.size > FASHION_CHAT_MAX_IMAGE_BYTES) {
            setImage(null);
            setImageError('Image is too large (max 4 MB).');
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            const dataUrl = reader.result as string;
            const check = validateFashionChatImage(dataUrl);
            if (!check.allowed) {
                setImage(null);
                setImageError('Could not use this image. Try a smaller JPEG, PNG, WebP, or GIF.');
                return;
            }
            setImageError(null);
            setImage(check.image || dataUrl);
        };
        reader.readAsDataURL(file);
    };

    return (
        <div className={`border-t border-gray-200 p-4 bg-white ${readOnly ? 'opacity-90' : ''}`}>
            {imageError && !readOnly && (
                <p className="mb-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {imageError}
                </p>
            )}

            {image && !readOnly && (
                <div className="mb-3 relative inline-block">
                    <img
                        src={image}
                        alt="Upload preview"
                        className="h-20 w-20 object-cover rounded-lg border border-gray-200"
                    />
                    <button
                        onClick={() => {
                            setImage(null);
                            setImageError(null);
                        }}
                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-sm hover:bg-red-600 transition-colors"
                    >
                        <X className="w-3 h-3" />
                    </button>
                </div>
            )}

            <div className="flex gap-2 items-end">
                {!readOnly && (
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleImageUpload}
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                />
                )}
                {!readOnly && (
                <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={disabled}
                    className="flex-shrink-0 w-10 h-10 border border-gray-300 text-gray-400 hover:text-[#D4AF37] hover:border-[#D4AF37] rounded-lg transition-colors duration-200 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Upload image"
                >
                    <ImageIcon className="w-5 h-5" />
                </button>
                )}

                <textarea
                    value={readOnly ? '' : message}
                    onChange={(e) => !readOnly && setMessage(e.target.value)}
                    onKeyPress={readOnly ? undefined : handleKeyPress}
                    placeholder={placeholder}
                    disabled={disabled}
                    readOnly={readOnly}
                    rows={1}
                    className={`flex-1 resize-none px-4 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed max-h-32 ${readOnly ? 'bg-gray-50 cursor-not-allowed' : ''}`}
                    style={{
                        minHeight: '42px',
                        maxHeight: '128px',
                    }}
                />
                {!readOnly && (
                <button
                    onClick={handleSend}
                    disabled={disabled || (!message.trim() && !image)}
                    className="flex-shrink-0 w-10 h-10 bg-[#D4AF37] hover:bg-[#B8941F] disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg transition-colors duration-200 flex items-center justify-center"
                    aria-label="Send message"
                >
                    <Send className="w-5 h-5" />
                </button>
                )}
            </div>

            {!hideHint && (
            <div className="flex justify-between items-center mt-2 px-1">
                <p className="text-xs text-gray-500">
                    Press Enter to send, Shift+Enter for new line
                </p>
            </div>
            )}
        </div>
    );
};

export default ChatInput;
