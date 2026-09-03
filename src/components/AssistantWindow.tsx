/**
 * AssistantWindow — the general assistant, in the same window as the other four chats.
 *
 * It was the odd one out. RAY SALES, RAY MARKETING, the automation builder and
 * RAY MAIL are floating windows you drag where you want and keep open while you
 * work. The assistant was a side drawer pinned to the edge behind a dimming
 * backdrop that closed it on any stray click — the wrong shape for the chat you
 * consult *about* the screen you are looking at, because it covers that screen.
 *
 * Reuses `useDraggableWindow`, the same hook the other four use, so the
 * behaviour cannot drift from theirs: no backdrop on a wide screen, the app
 * behind stays live, position remembered per chat, bottom sheet on phones.
 *
 * The expand button still goes full-screen. That is a deliberate exception —
 * "make this big" and "put this where I want it" are different requests, and
 * dragging a full-screen panel means nothing.
 *
 * A separate component rather than a branch inside App so the hook mounts with
 * the window: it measures the real panel to centre it, and a hook running while
 * the panel is closed would measure nothing and place the window by guesswork.
 */

import type { ComponentProps } from 'react';
import AiAssistant from '../pages/AiAssistant';
import { useDraggableWindow } from '../lib/useDraggableWindow';

type AssistantProps = Omit<ComponentProps<typeof AiAssistant>, 'dragHandleProps'>;

export default function AssistantWindow({
  isExpanded, ...props
}: AssistantProps & { isExpanded?: boolean }) {
  const { floating, backdropProps, panelProps, handleProps } = useDraggableWindow('assistant');

  // Full screen wins over floating: an expanded panel fills the viewport, so
  // there is nowhere to drag it to.
  const asWindow = floating && !isExpanded;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={asWindow ? backdropProps.style : { background: 'rgba(0,0,0,0.45)' }}
      onClick={asWindow ? undefined : props.onClose}
    >
      <div
        {...(asWindow ? panelProps : {})}
        onClick={e => e.stopPropagation()}
        // Floating: a sized window placed by the hook. Otherwise it fills the
        // viewport — which is both the phone layout and the expanded state.
        className={asWindow
          ? 'flex flex-col rounded-2xl overflow-hidden'
          : 'fixed inset-0 flex flex-col'}
        style={asWindow ? panelProps.style : { pointerEvents: 'auto' }}
      >
        <AiAssistant
          {...props}
          isExpanded={isExpanded}
          dragHandleProps={asWindow ? handleProps : undefined}
        />
      </div>
    </div>
  );
}
