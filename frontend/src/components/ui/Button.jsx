import { buttonClasses } from './buttonClasses';


export function Button({ variant = 'primary', size = 'md', className, type = 'button', ...props }) {
  return <button type={type} className={buttonClasses(variant, size, className)} {...props} />;
}
