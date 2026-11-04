// Short list of the properties an agent usually needs to fill in.
export function essentialsOf(propsJson: string): string {
  let props: any[];
  try {
    props = JSON.parse(propsJson);
  } catch {
    return "[]";
  }
  if (!Array.isArray(props)) return "[]";
  const essentials = props
    .filter((p) => p.required || /^(resource|operation|url|method)$/i.test(p.name ?? ""))
    .slice(0, 20)
    .map((p) => ({
      name: p.name,
      displayName: p.displayName,
      type: p.type,
      required: !!p.required,
      default: p.default,
      description: p.description,
      options: Array.isArray(p.options)
        ? p.options.slice(0, 12).map((o: any) => ({ name: o.name, value: o.value }))
        : undefined,
    }));
  return JSON.stringify(essentials);
}
