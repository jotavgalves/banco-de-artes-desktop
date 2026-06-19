function diffTokens(a, b) {
  const ta = a.split(' ');
  const tb = b.split(' ');
  let i = 0;
  while (i < ta.length && i < tb.length && ta[i] === tb[i]) i++;
  let j = 0;
  while (j < ta.length - i && j < tb.length - i &&
         ta[ta.length - 1 - j] === tb[tb.length - 1 - j]) j++;
  return {
    aPrefix: ta.slice(0, i), aMid: ta.slice(i, ta.length - j), aSuffix: ta.slice(ta.length - j),
    bPrefix: tb.slice(0, i), bMid: tb.slice(i, tb.length - j), bSuffix: tb.slice(tb.length - j)
  };
}

const cases = [
  {
    name: "Caso 1",
    a: "183 – PAINEL REDONDO 150X150.png",
    b: "183 – PAINEL REDONDO 50X50.png",
    expected: {
      aPrefix: ["183", "–", "PAINEL", "REDONDO"],
      aMid: ["150X150.png"],
      aSuffix: [],
      bPrefix: ["183", "–", "PAINEL", "REDONDO"],
      bMid: ["50X50.png"],
      bSuffix: []
    }
  },
  {
    name: "Caso 2 (nomes sem nada em comum)",
    a: "foto_gato.png",
    b: "foto_cachorro.png",
    expected: {
      aPrefix: [],
      aMid: ["foto_gato.png"],
      aSuffix: [],
      bPrefix: [],
      bMid: ["foto_cachorro.png"],
      bSuffix: []
    }
  },
  {
    name: "Caso 3 (nomes idênticos)",
    a: "arquivo.png",
    b: "arquivo.png",
    expected: {
      aPrefix: ["arquivo.png"],
      aMid: [],
      aSuffix: [],
      bPrefix: ["arquivo.png"],
      bMid: [],
      bSuffix: []
    }
  }
];

let allPassed = true;

cases.forEach(c => {
  const result = diffTokens(c.a, c.b);
  const resultStr = JSON.stringify(result);
  const expectedStr = JSON.stringify(c.expected);
  if (resultStr === expectedStr) {
    console.log(`PASS: ${c.name}`);
  } else {
    console.log(`FAIL: ${c.name}`);
    console.log(`  Esperado: ${expectedStr}`);
    console.log(`  Recebido: ${resultStr}`);
    allPassed = false;
  }
});

if (!allPassed) process.exit(1);
