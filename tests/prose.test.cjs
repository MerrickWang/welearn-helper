const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

// Exercise the actual answer-reading code without a browser or third-party DOM library.
const source = fs.readFileSync(path.join(__dirname, '..', 'welearn-helper.user.js'), 'utf8');
const normalization = source.slice(source.indexOf('    function normalized('), source.indexOf('    function decode('));
const reading = source.slice(source.indexOf('    function readAnswer('), source.indexOf('    function textValue('));
const context = vm.createContext({ COURSE_CHOICES: 'choices', COURSE_QUESTIONS: 'questions' });
vm.runInContext(normalization + reading, context);

function read(raw, type = 'fillinglong', sep = null) {
  const root = {
    matches(selector) { return selector !== 'choices' && selector.includes(`"${type}"`); },
    getAttribute(name) { return name === 'isblur' ? sep : null; },
    closest() { return null; },
  };
  return context.readAnswer(root, [{ getAttribute: () => raw }], new Map()).value;
}

test('joins source line breaks and removes indentation in long answers', () => {
  assert.equal(read(' From the captions at the beginning,\n                    we know the speaker\n                    is an authority. '),
    'From the captions at the beginning, we know the speaker is an authority.');
});
test('handles CRLF, tabs and nonbreaking spaces', () => {
  assert.equal(read('Yes.\r\n\t  Some\u00a0\u00a0information has been verified.'), 'Yes. Some information has been verified.');
});
test('preserves blank-line paragraph boundaries', () => {
  assert.equal(read('First\n  paragraph.\n \t\n\n  Second\n paragraph.'), 'First paragraph.\n\nSecond paragraph.');
});
test('keeps ordinary prose and punctuation unchanged', () => {
  assert.equal(read('He says, “Yes.” A/B is an example.'), 'He says, “Yes.” A/B is an example.');
});
test('still selects the first explicitly declared alternative', () => {
  assert.equal(read('First\n answer.|Second answer.', 'fillinglong', '|'), 'First answer.');
});
test('does not normalize other course question types', () => {
  assert.equal(read('line one\n  line two', 'filling'), 'line one\n  line two');
});
