const fs = require('fs');
const path = require('path');
const yargs = require('yargs/yargs')
const jsdom = require("jsdom");
const { hideBin } = require('yargs/helpers')
const {stringify} = require('csv-stringify');
const DOMParser = new jsdom.JSDOM().window.DOMParser;
const parser = new DOMParser();

const stringifier = stringify({
  header: true,
  columns: ['page title', 'type', 'message', 'text', 'rule', 'file', 'node path']
});

stringifier.pipe(process.stdout);

const targetTags = ['#text', 'para']; // these nodes are treated as single blocks of text
const notTargetTags = ['list', 'item', 'figure', 'table']; // these nodes are extracted before the text check and will be evaluated separately

const disabledRulesForTags = {
  'glossary term, glossary meaning, problem item, list item, table entry': [
    'UPPERCASE_SENTENCE_START'
  ],
  'emphasis': [
    'SENTENCE_WHITESPACE',
    'EN_A_VS_AN',
    'THE_SENT_END',
    'THE_PUNCT',
    'I_LOWERCASE',
  ],
  'footnote': [
    'SENTENCE_WHITESPACE'
  ],
}

function getNodeHeading(node, tail = '') {
  let result = `${node.nodeName}`
  if (node.id) {
    result += '#' + node.id;
  }

  if (node.parentNode) {
    result = getNodeHeading(node.parentNode, result);
  }

  return tail ? result + ' > ' + tail : result;
}

function processXMLFile(filePath) {
  return new Promise(resolve => fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error(`Error reading file: ${filePath}`, err);
      return;
    }

    const doc = parser.parseFromString(data, "application/xml");

    doc.querySelectorAll('link').forEach(link => link.textContent = 'LINK');
    doc.querySelectorAll('math').forEach(math => math.parentNode.replaceChild(math.ownerDocument.createTextNode('MATH'), math));

    processNode(filePath, doc.documentElement).then(resolve);
  }));
}

function disabledRulesForNode(node, inputDisabledRules = []) {
  const disabledRules = [...inputDisabledRules];

  Object.entries(disabledRulesForTags).forEach(([selector, rules]) => {
    if (node.matches?.(selector)) {
      disabledRules.push(...rules);
    }
  });

  return disabledRules;
}

async function processNode(filePath, node, inputDisabledRules = []) {
  const disabledRules = disabledRulesForNode(node, inputDisabledRules);
  let anyText = false;

  for (const n of node.childNodes) {
    if (n.nodeName === '#text' && n.textContent.trim().length > 0) {
      anyText = true;
    }
    if (notTargetTags.includes(n.nodeName)) {
      processNode(filePath, n, disabledRules);
      node.removeChild(n);
    }
  };

  if (anyText || targetTags.includes(node.nodeName)) {
    return processTargetNode(filePath, node, disabledRules);
  } else {
    for (const child of node.childNodes) {
      await processNode(filePath, child, disabledRules);
    }
  }
}

function recursiveWalk(node, visitor) {
  if (visitor(node) === false) return false;

  for (const child of node.childNodes) {
    if (recursiveWalk(child, visitor) === false) {
      return false;
    }
  }
}

function identifyTargetAtTextOffset(node, offset) {

  let text = '';
  let result;

  recursiveWalk(node, element => {
    if (element.nodeName === '#text') {
      text += element.textContent;
    }
    if (text.trimStart().length > offset) {
      result = element.parentNode;
      return false;
    }
  });

  return result;
}

async function processTargetNode(filePath, node, disabledRules) {

  if (node.nodeName !== '#text') {
    node.querySelectorAll('newline').forEach(newline => newline.parentNode.replaceChild(newline.ownerDocument.createTextNode('\n'), newline));
  }

  node.normalize();

  recursiveWalk(node, element => {
    if (element.nodeName === '#text') {
      // be forgiving of leading whitespace in the source file lines (for indentation of multi-line text)
      element.textContent = element.textContent.replace(/\n\s+/g, '\n');
    }
  });

  const text = node.textContent.trim();

  if (text) {
    const body = new URLSearchParams();
    body.append('language', 'en');
    body.append('text', text);
    body.append('disabledRules', disabledRules);

    const response = await fetch("http://localhost:8011/v2/check", {
      method: "POST",
      body
    }).then(response => response.json());

    const matches = response.matches.filter(match => {
      const element = identifyTargetAtTextOffset(node, match.offset);
      return !disabledRulesForNode(element).includes(match.rule.id)
    });

    if (matches.length > 0) {

      const title = node.ownerDocument.documentElement.querySelector('title').textContent;
      const nodeHeading = getNodeHeading(node);

      matches.forEach(match => {
        stringifier.write([
          title,
          match.rule.issueType,
          match.message,
          `${text.slice(0, match.offset)}[${text.slice(match.offset, match.offset + match.length)}]${text.slice(match.length + match.offset)}`,
          match.rule.id,
          filePath,
          nodeHeading,
        ]);
      });
    }
  }
}

function processDirectory(directoryPath) {
  return new Promise(resolve => fs.readdir(directoryPath, async(err, files) => {
    if (err) {
      console.error(`Error reading directory: ${directoryPath}`, err);
      return;
    }

    for (const file of files) {
      const filePath = path.join(directoryPath, file);
      const stats = fs.statSync(filePath);

      if (stats.isDirectory()) {
        await processDirectory(filePath); // Recursively call for subdirectories
      } else if (file.endsWith('.cnxml')) {
        await processXMLFile(filePath);
      }
    }

    resolve();
  }));
}

const argv = yargs(hideBin(process.argv)).argv;
const directoryPath = argv._[0];
processDirectory(directoryPath);
