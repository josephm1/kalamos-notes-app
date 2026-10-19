import {expect,it} from 'vitest';
import {markdownHtmlText} from './markdownHtml';
it('renders known Markdown HTML as inert readable text',()=>{
 expect(markdownHtmlText('<kbd>Ctrl</kbd>+<kbd>C</kbd> H<sub>2</sub>O 10<sup>9</sup>')).toBe('Ctrl+C H2O 109');
 expect(markdownHtmlText('<details><summary>Title</summary><p>Body &amp; text</p></details>')).toBe('Title\nBody & text\n');
});
it('rejects scripts, media and event attributes instead of mounting or dropping them',()=>{
 for(const html of ['<script>alert(1)</script>','<img src="https://example.com/x">','<span onclick="x()">Hi</span>','<style>body{}</style>'])expect(()=>markdownHtmlText(html)).toThrow('Unsupported Markdown HTML');
});
