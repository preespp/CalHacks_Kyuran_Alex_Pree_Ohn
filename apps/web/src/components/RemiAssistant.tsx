import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import AssistantPanel from './AssistantPanel';
import type { Health, MemoryObject } from '../types';

// The dialog closes visually; its assistant stays mounted for voice and chat history.
export default function RemiAssistant({
  open,
  onClose,
  ...assistant
}: {
  open: boolean;
  onClose: () => void;
  token: string;
  health: Health | null;
  settingsHost: HTMLElement | null;
  prompt: { id: number; text: string } | null;
  onAnswer: (answer: string) => void;
  onSelect: (item: MemoryObject) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="remi-chat-dialog remi-controls"
      aria-label="Chat with Remi"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="remi-dialog-head">
        <strong>Your household companion</strong>
        <button className="close-button" aria-label="Close Remi chat" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <AssistantPanel {...assistant} />
    </dialog>
  );
}
