import { Vim } from '@replit/codemirror-vim';

export function syncVimYanks(copy:(text:string)=>Promise<void>, onError:(error:unknown)=>void) {
  const registers = Vim.getRegisterController();
  const original = registers.pushText;
  const pushText:typeof original = function(registerName,operator,text,linewise,blockwise) {
    original.call(registers,registerName,operator,text,linewise,blockwise);
    if (operator === 'yank' && registerName !== '_') {
      // Read the completed register so linewise newlines and named registers are preserved.
      copy(registers.getRegister().toString()).catch(onError);
    }
  };
  registers.pushText = pushText;
  return () => { if (registers.pushText === pushText) registers.pushText = original; };
}
