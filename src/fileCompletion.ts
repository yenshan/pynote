import { Prec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { acceptCompletion, autocompletion, closeCompletion, completeAnyWord, completionStatus, moveCompletionSelection, startCompletion, type CompletionContext } from '@codemirror/autocomplete';
import { getCM } from '@replit/codemirror-vim';

function editing(view:EditorView) {
  const vim = getCM(view)?.state.vim;
  return !vim || vim.insertMode;
}

async function fileWords(context:CompletionContext) {
  if (context.view && (!editing(context.view) || context.view.composing)) return null;
  const result = await completeAnyWord(context);
  if (!result || context.aborted || (context.view && !editing(context.view))) return null;
  const current = context.state.sliceDoc(result.from,context.pos);
  return { ...result,options:result.options.filter(option => option.label !== current) };
}

export function fileCompletion() {
  return [
    autocompletion({ override:[fileWords],activateOnTyping:true,activateOnTypingDelay:150 }),
    // Handle completion before Vim consumes Tab, Enter, and the arrow keys.
    Prec.highest(EditorView.domEventHandlers({ keydown(event,view) {
      if (!editing(view) || event.isComposing || event.keyCode === 229) return false;
      if (event.ctrlKey && !event.metaKey && !event.altKey && (event.code === 'Space' || event.key === ' ')) {
        startCompletion(view); return true;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || completionStatus(view.state) !== 'active') return false;
      if (event.key === 'Tab' || event.key === 'Enter') return acceptCompletion(view);
      if (event.key === 'ArrowDown') return moveCompletionSelection(true)(view);
      if (event.key === 'ArrowUp') return moveCompletionSelection(false)(view);
      if (event.key === 'Escape') {
        closeCompletion(view);
        // Vim's Escape still leaves insert mode in the same keystroke.
        return !getCM(view)?.state.vim;
      }
      return false;
    } }))
  ];
}

export { closeCompletion };
