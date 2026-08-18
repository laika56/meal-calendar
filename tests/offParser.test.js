import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parseOffProduct } from '../src/lib/offParser.js';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/off-sample.json', import.meta.url), 'utf8'),
);

test('returns null when OFF reports that the barcode was not found', () => {
  assert.equal(parseOffProduct(fixture.not_found), null);
});

test('returns null when a found response has no product object', () => {
  assert.equal(parseOffProduct({ code: fixture.not_found.code, status: 1 }), null);
});

for (const key of ['per_100g_complete', 'per_100g_complete_2']) {
  test(`maps all four unsuffixed per-100g nutrients from ${key}`, () => {
    const response = fixture[key];
    const { product } = response;

    assert.deepEqual(parseOffProduct(response), {
      code: response.code,
      name: product.product_name,
      brand: product.brands,
      unit: 'g',
      per100: {
        kcal: product.nutriments['energy-kcal'],
        proteinG: product.nutriments.proteins,
        fatG: product.nutriments.fat,
        carbG: product.nutriments.carbohydrates,
      },
    });
  });
}

test('uses nutrition_data_per instead of inferring an ml unit from a liquid product', () => {
  const response = fixture.per_100g_liquid_product;
  const parsed = parseOffProduct(response);

  assert.equal(response.product.quantity, '230ml');
  assert.equal(response.product.nutrition_data_per, '100g');
  assert.equal(parsed.unit, 'g');
});

test('maps a 100ml nutrition basis to the ml unit', () => {
  const response = fixture.per_100ml;
  const parsed = parseOffProduct(response);

  assert.equal(parsed.unit, 'ml');
  assert.deepEqual(parsed.per100, {
    kcal: response.product.nutriments['energy-kcal'],
    proteinG: response.product.nutriments.proteins,
    fatG: response.product.nutriments.fat,
    carbG: response.product.nutriments.carbohydrates,
  });
});

test('keeps identity fields but returns no unit or nutrients when nutrition data is absent', () => {
  const response = fixture.no_nutrition_data;

  assert.deepEqual(parseOffProduct(response), {
    code: response.code,
    name: response.product.product_name,
    brand: response.product.brands,
    unit: null,
    per100: null,
  });
});

test('treats an explicit null nutrition_data_per as absent nutrition data', () => {
  const base = fixture.no_nutrition_data;
  const response = {
    ...base,
    product: {
      ...base.product,
      nutrition_data_per: null,
    },
  };

  assert.deepEqual(parseOffProduct(response), {
    code: response.code,
    name: response.product.product_name,
    brand: response.product.brands,
    unit: null,
    per100: null,
  });
});

test('maps every missing core macro to null without rejecting the product', () => {
  const response = fixture.partial_missing_core_macros;

  assert.deepEqual(parseOffProduct(response), {
    code: response.code,
    name: response.product.product_name,
    brand: response.product.brands,
    unit: 'g',
    per100: {
      kcal: null,
      proteinG: null,
      fatG: null,
      carbG: null,
    },
  });
});

test('maps a missing nutriments object to four null macros', () => {
  const base = fixture.per_100g_complete;
  const { nutriments, ...productWithoutNutriments } = base.product;

  assert.deepEqual(parseOffProduct({ ...base, product: productWithoutNutriments }), {
    code: base.code,
    name: base.product.product_name,
    brand: base.product.brands,
    unit: 'g',
    per100: {
      kcal: null,
      proteinG: null,
      fatG: null,
      carbG: null,
    },
  });
});

test('does not parse a parenthesized serving_size when per-100g nutrients are available', () => {
  const response = fixture.serving_with_parens;
  const { product } = response;

  assert.equal(product.serving_size, '1 portion (120 g)');
  assert.deepEqual(parseOffProduct(response), {
    code: response.code,
    name: product.product_name,
    brand: product.brands,
    unit: 'g',
    per100: {
      kcal: product.nutriments['energy-kcal'],
      proteinG: product.nutriments.proteins,
      fatG: product.nutriments.fat,
      carbG: product.nutriments.carbohydrates,
    },
  });
});

test('rejects an unexpected nutrition_data_per without inferring a unit', () => {
  const response = {
    ...fixture.per_100g_complete,
    product: {
      ...fixture.per_100g_complete.product,
      nutrition_data_per: '1 serving',
    },
  };

  assert.throws(
    () => parseOffProduct(response),
    (error) => (
      error.name === 'Error'
      && error.message.includes('nutrition_data_per')
      && error.message.includes('1 serving')
      && error.message.includes(response.code)
    ),
  );
});

test('rejects a string energy-kcal value and identifies kcal in the error', () => {
  const base = fixture.per_100g_complete;
  const response = {
    ...base,
    product: {
      ...base.product,
      nutriments: {
        ...base.product.nutriments,
        'energy-kcal': 'abc',
      },
    },
  };

  assert.throws(
    () => parseOffProduct(response),
    (error) => error.name === 'Error' && error.message.includes('kcal'),
  );
});

test('rejects a negative protein value and identifies the negative proteinG field', () => {
  const base = fixture.per_100g_complete;
  const response = {
    ...base,
    product: {
      ...base.product,
      nutriments: {
        ...base.product.nutriments,
        proteins: -3,
      },
    },
  };

  assert.throws(
    () => parseOffProduct(response),
    (error) => (
      error.name === 'Error'
      && error.message.includes('proteinG')
      && error.message.includes('negative')
    ),
  );
});

test('rejects every non-finite numeric nutrient value', () => {
  const base = fixture.per_100g_complete;
  const cases = [
    ['energy-kcal', 'kcal', Number.NaN],
    ['proteins', 'proteinG', Number.POSITIVE_INFINITY],
    ['fat', 'fatG', Number.NEGATIVE_INFINITY],
    ['carbohydrates', 'carbG', Number.NaN],
  ];

  for (const [field, label, value] of cases) {
    const response = {
      ...base,
      product: {
        ...base.product,
        nutriments: {
          ...base.product.nutriments,
          [field]: value,
        },
      },
    };

    assert.throws(
      () => parseOffProduct(response),
      (error) => (
        error.name === 'Error'
        && error.message.includes(label)
        && error.message.includes(response.code)
      ),
    );
  }
});

test('maps absent product_name and brands fields to null', () => {
  const base = fixture.per_100g_complete;
  const { product_name, brands, ...productWithoutIdentity } = base.product;
  const parsed = parseOffProduct({ ...base, product: productWithoutIdentity });

  assert.equal(parsed.name, null);
  assert.equal(parsed.brand, null);
});
