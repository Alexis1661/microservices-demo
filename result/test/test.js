const assert = require('assert');

describe('Result Service', function () {
  it('debería sumar correctamente', function () {
    assert.strictEqual(1 + 1, 2);
  });

  it('debería verificar que el entorno es Node.js', function () {
    assert.ok(process.version.startsWith('v'));
  });
});
