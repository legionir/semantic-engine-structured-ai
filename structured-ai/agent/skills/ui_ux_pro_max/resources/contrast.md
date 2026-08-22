# Colour contrast

Minimums, from WCAG 2.1:

- Body text: 4.5:1 against its background.
- Text at 18px bold or 24px regular and above: 3:1.
- A control's focus ring and its border: 3:1 against what surrounds it.

Working them out:

    L = 0.2126 R + 0.7152 G + 0.0722 B     on linearised channels
    ratio = (L_lighter + 0.05) / (L_darker + 0.05)

On the dark surfaces this project uses:

- #e6e9ef on #0f1115 is 14.8:1, comfortable for body text.
- #8b93a7 on #161922 is 5.3:1, the floor for secondary text.
- #6ea8fe on #161922 is 6.4:1, so an accent may carry text.
- A muted colour on a muted background is where this fails: check it
  rather than assuming.
