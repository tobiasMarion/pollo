export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class BadRequestError extends HttpError {
  constructor(message = 'Bad request.') {
    super(400, message)
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'Unauthorized.') {
    super(401, message)
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Not found.') {
    super(404, message)
  }
}
