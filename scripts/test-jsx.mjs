import { compileJSX } from '../src/lib/jsxCompiler.js';

const code = `const docs = [
  { _id: 'a1', name: 'Keyboard', price: 100 },
  { _id: 'b2', name: 'Mouse', price: 25 },
];
return (
  <div className="p-4">
    {docs.map(doc => (
      <div key={doc._id}>{doc.name}</div>
    ))}
  </div>
);`;

try {
  const compiled = compileJSX(code);
  console.log('Compiled:');
  console.log(compiled.code);
} catch (e) {
  console.log('Compile FAIL:', e.message);
}
