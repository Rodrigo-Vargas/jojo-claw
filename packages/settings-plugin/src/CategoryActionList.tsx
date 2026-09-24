export interface GmailLabel {
  id: string;
  name: string;
}

interface CategoryActionListProps {
  categories: string[];
  labels: GmailLabel[];
  settingName: string;
  values: string[];
  onChange(items: string[]): void;
}

/** Renders email-assistant actions grouped by the configured email category. */
export function CategoryActionList({
  categories, labels, settingName, values, onChange,
}: CategoryActionListProps) {
  const actions = categoryActionMap(values);
  function setActions(category: string, selectedActions: string[]) {
    const nextActions = new Map(actions);
    if (selectedActions.length) nextActions.set(category, selectedActions);
    else nextActions.delete(category);
    onChange([...nextActions].map(([name, actionValues]) =>
      JSON.stringify({ category: name, actions: actionValues }),
    ));
  }
  return <div className="setting-list-editor">
    <span>Suggested actions by category</span>
    {categories.map((category) => <label key={category}>
      <span>{category}</span>
      <select multiple aria-label={`${settingName} ${category}`} value={actions.get(category) ?? []}
        onChange={(event) => setActions(
          category,
          [...event.currentTarget.selectedOptions].map((option) => option.value),
        )}>
        <option value="mark-read">Mark as read</option>
        <option value="star">Star</option>
        <option value="trash">Move to trash</option>
        {labels.map((label) => <option key={label.id} value={`archive:${label.name}`}>
          Archive in {label.name}
        </option>)}
      </select>
    </label>)}
    {categories.length === 0 && <span>Add email categories before mapping actions.</span>}
  </div>;
}

export function isCategoryActionSetting(pluginId: string, settingId: string): boolean {
  return pluginId === "email-assistant" && settingId === "category-actions";
}

export function emailCategoryNames(settings: ReadonlyArray<{
  pluginId: string;
  id: string;
  value: unknown;
}>): string[] {
  const categorySetting = settings.find(
    (setting) => setting.pluginId === "email-assistant" && setting.id === "categories",
  );
  if (!categorySetting || !Array.isArray(categorySetting.value)) return [];
  return categorySetting.value.flatMap(categoryName);
}

function categoryName(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!value || typeof value !== "object") return [];
  const name = (value as { name?: unknown }).name;
  return typeof name === "string" && name.trim() ? [name.trim()] : [];
}

function categoryActionMap(values: string[]): Map<string, string[]> {
  return new Map(values.flatMap(categoryActionEntry));
}

function categoryActionEntry(value: string): Array<[string, string[]]> {
  try {
    const entry = JSON.parse(value) as {
      category?: unknown;
      action?: unknown;
      actions?: unknown;
    };
    const actions = Array.isArray(entry.actions) ? entry.actions : [entry.action];
    if (typeof entry.category !== "string" || !actions.every(isString)) return [];
    return [[entry.category, actions]];
  } catch {
    return [];
  }
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
