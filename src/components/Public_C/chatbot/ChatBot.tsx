"use client";
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ChatButton from './ChatButton';
import ChatWindow from './ChatWindow';

const ChatBot: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  // Defer ChatWindow mount until first open so /api/ai-settings + chat history
  // do not compete with homepage/product loads. Keep mounted after that so the
  // transcript survives minimize.
  const [hasOpened, setHasOpened] = useState(false);

  const openChat = () => {
    setHasOpened(true);
    setIsOpen(true);
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3">
      {hasOpened && (
        <div
          className={isOpen ? 'block' : 'hidden'}
          aria-hidden={!isOpen}
        >
          <motion.div
            initial={false}
            animate={
              isOpen
                ? { opacity: 1, y: 0, scale: 1 }
                : { opacity: 0, y: 12, scale: 0.98 }
            }
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="origin-bottom-right"
          >
            <ChatWindow onClose={() => setIsOpen(false)} />
          </motion.div>
        </div>
      )}

      <AnimatePresence mode="wait">
        {!isOpen && (
          <motion.div
            key="chat-button"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.2 }}
          >
            <ChatButton isOpen={isOpen} onClick={openChat} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ChatBot;
