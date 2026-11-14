// Copy buttons for the command blocks. The copied text is the command itself, nothing else.
(function () {
  document.querySelectorAll("[data-copy] .copy").forEach(function (button) {
    button.addEventListener("click", function () {
      var text = button.parentElement.querySelector("code").textContent;
      navigator.clipboard.writeText(text).then(function () {
        button.textContent = "Copied";
        setTimeout(function () { button.textContent = "Copy"; }, 1600);
      }, function () {
        button.textContent = "Select and copy";
      });
    });
  });
})();
