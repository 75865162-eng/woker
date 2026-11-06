import { SaxesParser } from "saxes";

export type WorkbookXmlElement = {
  attributes: Record<string, string>;
  start: number;
  end: number;
};

/** Parse small workbook metadata without browser globals. Retain spans to preserve untouched XML. */
export function readWorkbookXmlElements(xml: string, localName: string): WorkbookXmlElement[] {
  const parser = new SaxesParser({ xmlns: true });
  const stack: Array<WorkbookXmlElement | null> = [];
  const elements: WorkbookXmlElement[] = [];
  let start = 0;
  parser.on("doctype", () => { throw new Error("Workbook metadata must not contain a DOCTYPE."); });
  parser.on("opentagstart", () => { start = xml.lastIndexOf("<", parser.position - 1); });
  parser.on("opentag", tag => {
    if (tag.local !== localName) { stack.push(null); return; }
    const attributes = Object.fromEntries(Object.entries(tag.attributes).map(([name, value]) => [name, value.value]));
    stack.push({ attributes, start, end: 0 });
  });
  parser.on("closetag", () => {
    const element = stack.pop();
    if (element) { element.end = parser.position; elements.push(element); }
  });
  parser.write(xml).close();
  return elements.sort((left, right) => left.start - right.start);
}

export function removeWorkbookXmlElements(xml: string, elements: WorkbookXmlElement[]) {
  // Drop nested spans as the outer removal already includes them.
  let end = -1;
  const spans = elements.filter(element => {
    if (element.start < end) return false;
    end = element.end;
    return true;
  });
  return spans.reduceRight((text, element) => text.slice(0, element.start) + text.slice(element.end), xml);
}
