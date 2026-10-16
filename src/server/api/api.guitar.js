import {
  findOperation,
  GuitarLibraryError,
  loadLibrary
} from '../services/guitar-library';
import { ERR_INTERNAL_SERVER_ERROR } from '../constants';

const sendError = (res, err) => {
  const expected = err instanceof GuitarLibraryError;
  res.status(expected ? err.status : ERR_INTERNAL_SERVER_ERROR).send({
    msg: expected ? err.message : 'Failed to read the guitar library'
  });
};

export const catalog = (req, res) => {
  try {
    res.send(loadLibrary());
  } catch (err) {
    sendError(res, err);
  }
};

export const operation = (req, res) => {
  try {
    res.send(findOperation(req.body || {}));
  } catch (err) {
    sendError(res, err);
  }
};
