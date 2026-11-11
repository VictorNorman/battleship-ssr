import { Router } from 'express';
import { cleanName, safeNext, setViewer, viewerOf } from '../identity.js';
import { namePage } from '../views.js';

export const identityRoutes = Router();

identityRoutes.get('/', (req, res) => {
  res.send(namePage(viewerOf(req), safeNext(req.query.next), null).value);
});

identityRoutes.post('/name', (req, res) => {
  const next = safeNext(req.body?.next);
  const name = cleanName(req.body?.name);
  if (name === null) {
    res
      .status(400)
      .send(namePage(viewerOf(req), next, 'Please enter a name of 1 to 24 characters.').value);
    return;
  }
  setViewer(res, name);
  // Post/Redirect/Get: a refresh after submitting will not resubmit the form.
  res.redirect(303, next);
});
