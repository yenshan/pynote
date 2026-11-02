import { StreamLanguage } from '@codemirror/language';
import { python } from '@codemirror/legacy-modes/mode/python';

export const pythonLanguage = StreamLanguage.define(python);
