/* eslint-disable no-unused-vars, no-undef -- Apps Script combines project files in one global scope. */

var STABLE_ITEM_ID_PATTERN = /^(?:[a-z0-9]+(?:-[a-z0-9]+)*|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

function validateAndBuildDraft_(menuValues, stateValues) {
  var issues = [];
  validateHeaders_(menuValues[0], MENU_HEADERS, APP_CONFIG.tabs.menu, issues);
  validateHeaders_(stateValues[0], STATE_HEADERS, APP_CONFIG.tabs.state, issues);

  var parsedItems = parseMenuRows_(menuValues.slice(1), issues);
  var business = parseBusinessState_(stateValues.slice(1), issues);
  validateItemUniqueness_(parsedItems, issues);

  var visibleItems = parsedItems
    .filter(function (item) { return item.visible; })
    .sort(compareItems_)
    .map(function (item) {
      return {
        id: item.id,
        category_code: item.category_code,
        name: item.name,
        description: item.description,
        order_index: item.order_index,
        prices: item.prices,
      };
    });

  var categories = CATEGORY_DEFINITIONS.map(function (definition) {
    return {
      code: definition.id,
      title: definition.name,
      order_index: definition.orderIndex,
      price_kinds: definition.allowedPriceKinds.slice(),
      items: visibleItems.filter(function (item) {
        return item.category_code === definition.id;
      }),
    };
  });

  return {
    ok: issues.length === 0,
    issues: issues,
    draft: {
      currency: "ARS",
      business: business,
      categories: categories,
    },
  };
}

function validateHeaders_(actual, expected, sheetName, issues) {
  if (!Array.isArray(actual)) {
    issues.push(issue_(sheetName, 1, 1, "Falta la fila de encabezados."));
    return;
  }

  expected.forEach(function (header, index) {
    if (normalizeText_(actual[index]) !== header) {
      issues.push(issue_(
        sheetName,
        1,
        index + 1,
        "El encabezado debe ser \"" + header + "\".",
      ));
    }
  });
}

function parseMenuRows_(rows, issues) {
  var items = [];

  rows.forEach(function (row, index) {
    var sheetRow = index + 2;
    if (isEmptyMenuRow_(row)) return;

    var id = normalizeText_(row[0]);
    var category = findCategory_(row[1]);
    var orderIndex = parsePositiveInteger_(row[2]);
    var name = normalizeText_(row[3]);
    var description = normalizeText_(row[4]);
    var visible = parseVisibility_(row[9]);

    if (!STABLE_ITEM_ID_PATTERN.test(id)) {
      issues.push(issue_(APP_CONFIG.tabs.menu, sheetRow, 1, "El ID debe ser estable y usar formato kebab-case o UUID."));
    }
    if (!category) {
      issues.push(issue_(APP_CONFIG.tabs.menu, sheetRow, 2, "Elegí una categoría válida."));
    }
    if (orderIndex === null) {
      issues.push(issue_(APP_CONFIG.tabs.menu, sheetRow, 3, "El orden debe ser un entero positivo."));
    }
    if (!name) {
      issues.push(issue_(APP_CONFIG.tabs.menu, sheetRow, 4, "El nombre es obligatorio."));
    }
    if (visible === null) {
      issues.push(issue_(APP_CONFIG.tabs.menu, sheetRow, 10, "Visible debe ser Sí o No."));
    }

    var prices = category
      ? parsePrices_(row, category, sheetRow, issues)
      : {};

    items.push({
      id: id,
      category_code: category ? category.id : "",
      name: name,
      description: description || null,
      order_index: orderIndex === null ? 0 : orderIndex,
      prices: prices,
      visible: visible === true,
      sheetRow: sheetRow,
    });
  });

  return items;
}

function parsePrices_(row, category, sheetRow, issues) {
  var prices = {};
  var allowedKinds = category.allowedPriceKinds;

  Object.keys(PRICE_COLUMNS).forEach(function (kind) {
    var column = PRICE_COLUMNS[kind];
    var rawValue = row[column - 1];
    var allowed = allowedKinds.indexOf(kind) !== -1;

    if (allowed) {
      var amount = parsePositiveInteger_(rawValue);
      if (amount === null) {
        issues.push(issue_(APP_CONFIG.tabs.menu, sheetRow, column, "Ingresá un precio entero positivo."));
      } else {
        prices[kind] = amount;
      }
      return;
    }

    if (!isBlank_(rawValue)) {
      issues.push(issue_(APP_CONFIG.tabs.menu, sheetRow, column, "Este precio no corresponde a la categoría elegida."));
    }
  });

  return prices;
}

function parseBusinessState_(rows, issues) {
  var fields = {};

  rows.forEach(function (row, index) {
    if (isBlank_(row[0]) && isBlank_(row[1])) return;
    var field = normalizeText_(row[0]);
    if (field !== "estado" && field !== "mensaje") {
      issues.push(issue_(APP_CONFIG.tabs.state, index + 2, 1, "El campo debe ser estado o mensaje."));
      return;
    }
    if (Object.prototype.hasOwnProperty.call(fields, field)) {
      issues.push(issue_(APP_CONFIG.tabs.state, index + 2, 1, "El campo está duplicado."));
      return;
    }
    fields[field] = row[1];
  });

  var statusLabel = normalizeText_(fields.estado);
  var status = STATUS_BY_SHEET_LABEL[statusLabel];
  var message = normalizeText_(fields.mensaje);

  if (!status) {
    issues.push(issue_(APP_CONFIG.tabs.state, 2, 2, "Elegí Abierto, Cerrado o Agotado."));
  }
  if (message.length > 160) {
    issues.push(issue_(APP_CONFIG.tabs.state, 3, 2, "El mensaje no puede superar los 160 caracteres."));
  }

  return { status: status || "closed", message: message };
}

function validateItemUniqueness_(items, issues) {
  var seenIds = {};
  var seenOrders = {};

  items.forEach(function (item) {
    if (item.id && seenIds[item.id]) {
      issues.push(issue_(APP_CONFIG.tabs.menu, item.sheetRow, 1, "El ID está duplicado con la fila " + seenIds[item.id] + "."));
    } else if (item.id) {
      seenIds[item.id] = item.sheetRow;
    }

    if (!item.category_code || !item.order_index) return;
    var orderKey = item.category_code + ":" + item.order_index;
    if (seenOrders[orderKey]) {
      issues.push(issue_(APP_CONFIG.tabs.menu, item.sheetRow, 3, "El orden está duplicado con la fila " + seenOrders[orderKey] + " de la misma categoría."));
    } else {
      seenOrders[orderKey] = item.sheetRow;
    }
  });
}

function findCategory_(value) {
  var normalized = normalizeText_(value);
  return CATEGORY_DEFINITIONS.find(function (definition) {
    return definition.sheetLabel === normalized;
  }) || null;
}

function parsePositiveInteger_(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  var text = normalizeText_(value);
  if (!/^[1-9][0-9]*$/.test(text)) return null;
  var number = Number(text);
  return Number.isSafeInteger(number) ? number : null;
}

function parseVisibility_(value) {
  if (value === true) return true;
  if (value === false) return false;
  var normalized = normalizeText_(value).toLocaleLowerCase("es-AR");
  if (normalized === "sí" || normalized === "si") return true;
  if (normalized === "no") return false;
  return null;
}

function compareItems_(left, right) {
  var leftCategory = CATEGORY_DEFINITIONS.findIndex(function (definition) {
    return definition.id === left.category_code;
  });
  var rightCategory = CATEGORY_DEFINITIONS.findIndex(function (definition) {
    return definition.id === right.category_code;
  });
  return leftCategory - rightCategory || left.order_index - right.order_index;
}

function issue_(sheet, row, column, message) {
  return {
    sheet: sheet,
    row: row,
    column: column,
    path: sheet + "!" + columnToLetter_(column) + row,
    message: message,
  };
}

function columnToLetter_(column) {
  var value = column;
  var result = "";
  while (value > 0) {
    var remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function normalizeText_(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function isBlank_(value) {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function isEmptyMenuRow_(row) {
  return !row || row.every(isBlank_);
}
