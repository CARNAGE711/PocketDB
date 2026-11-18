const { compileJSX } = require('./src/lib/jsxCompiler.js');
const { evalJSX } = require('./src/lib/jsxEval.js');
const React = require('react');

// Test 1: Hello World (default example)
const code1 = `<div className="p-4 bg-ink-850 rounded-lg border border-ink-700">
  <h1 className="text-slate-200 font-mono text-lg">Hello, PocketDB!</h1>
  <p className="text-slate-500 text-sm">A React element, compiled and rendered offline.</p>
</div>`;
const c1 = compileJSX(code1);
console.log('Test 1 compiled:');
console.log(c1.code);
const r1 = evalJSX(c1.code, { React });
console.log('Test 1 result:', r1.error || 'OK, element type: ' + (r1.element && r1.element.type));

// Test 2: with expression child
const code2 = '<div>{name}</div>';
const c2 = compileJSX(code2);
console.log('\nTest 2 compiled:', c2.code);
const r2 = evalJSX(c2.code, { React, name: 'World' });
console.log('Test 2 result:', r2.error || 'OK');

// Test 3: example with const + return (like Interactive Counter)
const code3 = `const [count, setCount] = React.useState(0);
return (
  <div className="p-4">
    <span>{count}</span>
    <button onClick={() => setCount(c => c + 1)}>+</button>
  </div>
);`;
const c3 = compileJSX(code3);
console.log('\nTest 3 compiled:');
console.log(c3.code);
try {
  const r3 = evalJSX(c3.code, { React });
  console.log('Test 3 result:', r3.error || 'OK');
} catch (e) {
  console.log('Test 3 threw:', e.message);
}

// Test 4: Document List example
const code4 = `const docs = [
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
const c4 = compileJSX(code4);
console.log('\nTest 4 compiled:');
console.log(c4.code);
try {
  const r4 = evalJSX(c4.code, { React });
  console.log('Test 4 result:', r4.error || 'OK');
} catch (e) {
  console.log('Test 4 threw:', e.message);
}
