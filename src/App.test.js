import React from 'react';
import { render } from '@testing-library/react';
import App from './App';

test('renders main header', () => {
  const { getByText } = render(<App />);
  const linkElement = getByText(/Payment flow demo/i);
  expect(linkElement).toBeInTheDocument();
});
