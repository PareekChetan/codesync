import type { Language } from './api';

export const LANGUAGES: { id: Language; label: string; runnable: boolean; starter: string }[] = [
  {
    id: 'javascript',
    label: 'JavaScript',
    runnable: true,
    starter: '// Press Run (Ctrl+Enter). Read input with: require("fs").readFileSync(0, "utf8")\nconsole.log("Hello from CodeSync!");\n',
  },
  {
    id: 'typescript',
    label: 'TypeScript',
    runnable: true,
    starter: 'const greet = (name: string): string => `Hello, ${name}!`;\nconsole.log(greet("CodeSync"));\n',
  },
  {
    id: 'python',
    label: 'Python',
    runnable: true,
    starter: '# Type input in the Input box, then press Run\nname = input() or "CodeSync"\nprint(f"Hello, {name}!")\n',
  },
  {
    id: 'java',
    label: 'Java',
    runnable: true,
    starter:
      'import java.util.*;\n\nclass Solution {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        System.out.println("Hello from Java!");\n    }\n}\n',
  },
  {
    id: 'cpp',
    label: 'C++',
    runnable: true,
    starter: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    cout << "Hello from C++!" << endl;\n    return 0;\n}\n',
  },
  {
    id: 'go',
    label: 'Go',
    runnable: true,
    starter: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello from Go!")\n}\n',
  },
  {
    id: 'html',
    label: 'HTML',
    runnable: true, // "Run" renders a live preview in a sandboxed frame
    starter:
      '<!doctype html>\n<html>\n<head>\n  <style>\n    body { font-family: sans-serif; padding: 24px; }\n    h1 { color: #2563eb; }\n  </style>\n</head>\n<body>\n  <h1>Hello from CodeSync</h1>\n  <button onclick="this.textContent = \'Clicked!\'">Click me</button>\n</body>\n</html>\n',
  },
  { id: 'css', label: 'CSS', runnable: false, starter: 'body {\n}\n' },
  { id: 'markdown', label: 'Markdown', runnable: false, starter: '# Notes\n' },
];

export const languageLabel = (id: Language) => LANGUAGES.find((l) => l.id === id)?.label ?? id;
