export function generateTabTitle(sql: string): string {
  const s = sql.trim().replace(/\s+/g, " ");

  const select = s.match(/^select\b.*?\bfrom\s+([a-zA-Z0-9_.\[\]"]+)/i);
  if (select) return `Select ${unquoteIdentifier(select[1])}`;

  const update = s.match(/^update\s+([a-zA-Z0-9_.\[\]"]+)/i);
  if (update) return `Update ${unquoteIdentifier(update[1])}`;

  const insert = s.match(/^insert\s+into\s+([a-zA-Z0-9_.\[\]"]+)/i);
  if (insert) return `Insert ${unquoteIdentifier(insert[1])}`;

  const del = s.match(/^delete\s+from\s+([a-zA-Z0-9_.\[\]"]+)/i);
  if (del) return `Delete ${unquoteIdentifier(del[1])}`;

  const create = s.match(/^create\s+(?:table|view|index|procedure|function)\s+([a-zA-Z0-9_.\[\]"]+)/i);
  if (create) return `Create ${unquoteIdentifier(create[1])}`;

  const drop = s.match(/^drop\s+(?:table|view|index|procedure|function)\s+([a-zA-Z0-9_.\[\]"]+)/i);
  if (drop) return `Drop ${unquoteIdentifier(drop[1])}`;

  const alter = s.match(/^alter\s+table\s+([a-zA-Z0-9_.\[\]"]+)/i);
  if (alter) return `Alter ${unquoteIdentifier(alter[1])}`;

  return "";
}

function unquoteIdentifier(name: string): string {
  const part = name.split(".").pop() ?? name;
  return part.replace(/^\[|\]$|^"|"$/g, "");
}
