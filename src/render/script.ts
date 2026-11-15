/**
 * The only script in the report. It reads no report data (copy text comes from
 * the DOM), so nothing untrusted is ever placed inside a <script> element.
 */
export const SCRIPT = `(function(){
var root=document.documentElement;root.classList.add("js");
function fallback(pre){var range=document.createRange();range.selectNodeContents(pre);var sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);try{return document.execCommand("copy")}catch(e){return false}}
function flash(button,text){button.textContent=text;clearTimeout(button._t);button._t=setTimeout(function(){button.textContent="Copy"},1800)}
document.addEventListener("click",function(event){
var button=event.target&&event.target.closest?event.target.closest("[data-copy]"):null;if(!button)return;
var pre=document.getElementById(button.getAttribute("data-copy"));if(!pre)return;
var text=pre.textContent||"";
if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(text).then(function(){flash(button,"Copied")},function(){flash(button,fallback(pre)?"Copied":"Select and copy")})}
else{flash(button,fallback(pre)?"Copied":"Select and copy")}
});
var scrollers=document.querySelectorAll("[data-scroll-end]");for(var i=0;i<scrollers.length;i++){scrollers[i].scrollLeft=scrollers[i].scrollWidth}
})();`;
