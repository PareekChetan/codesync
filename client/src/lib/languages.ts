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
  {
    id: 'css',
    label: 'CSS',
    runnable: true, // "Run" previews these styles on a sample page
    starter:
      '/* Press Run to see these styles on a sample page */\nbody {\n  font-family: system-ui, sans-serif;\n  padding: 24px;\n}\n\nh1 {\n  color: #2563eb;\n}\n\n.btn {\n  background: #2563eb;\n  color: white;\n  border: none;\n  padding: 8px 16px;\n  border-radius: 8px;\n}\n\n.card {\n  border: 1px solid #ddd;\n  border-radius: 12px;\n  padding: 16px;\n}\n',
  },
  { id: 'markdown', label: 'Markdown', runnable: false, starter: '# Notes\n' },
];

export const languageLabel = (id: Language) => LANGUAGES.find((l) => l.id === id)?.label ?? id;

/**
 * Sample page that CSS rooms are previewed on. Uses common elements and class
 * names (.container, .card, .btn, .grid...) so most stylesheets have something to style.
 */
export function cssPreviewPage(css: string): string {
  // A literal </style> in the user's CSS would end the style block early.
  const safe = css.replace(/<\/style/gi, '<\\/style');
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><style>${safe}</style></head>
<body>
  <div class="container">
    <header class="header"><nav class="nav"><a href="#">Home</a> <a href="#">About</a> <a href="#">Contact</a></nav></header>
    <h1>Heading 1</h1>
    <h2>Heading 2</h2>
    <h3>Heading 3</h3>
    <p>This is a paragraph with <a href="#">a link</a>, <strong>bold text</strong> and <em>italic text</em>.</p>
    <div class="grid">
      <div class="card"><h3>Card title</h3><p>Some text inside a card.</p><button class="btn">Button</button></div>
      <div class="card"><h3>Another card</h3><p>Cards use the class "card".</p><button class="btn btn-secondary">Secondary</button></div>
    </div>
    <form class="form">
      <label>Name <input type="text" placeholder="Your name"></label>
      <label>Email <input type="email" placeholder="you@example.com"></label>
      <button type="button">Submit</button>
    </form>
    <ul><li>List item one</li><li>List item two</li><li>List item three</li></ul>
    <table>
      <thead><tr><th>Name</th><th>Role</th></tr></thead>
      <tbody><tr><td>Asha</td><td>Frontend</td></tr><tr><td>Ravi</td><td>Backend</td></tr></tbody>
    </table>
    <footer class="footer">Footer text</footer>
  </div>
</body>
</html>`;
}
