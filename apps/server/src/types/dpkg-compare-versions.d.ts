declare module "dpkg-compare-versions" {
  /** Returns < 0 if v1 < v2, 0 if equal, > 0 if v1 > v2. Throws on malformed input. */
  function compare(v1: string, v2: string): number;
  export default compare;
}
