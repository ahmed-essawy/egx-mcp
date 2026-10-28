export function bindMember(target: object, property: string | symbol): unknown {
  const member = Reflect.get(target, property);
  return typeof member === "function" ? member.bind(target) : member;
}
