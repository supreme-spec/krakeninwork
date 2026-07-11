import { useCategories, FALLBACK_CATEGORIES as _FALLBACK } from '../hooks/useCategories'

interface Props {
  category: string
  size?: 'sm' | 'md'
  /** Передать категории снаружи чтобы не делать лишний хук */
  categories?: ReturnType<typeof useCategories>['categories']
}

export default function CategoryBadge({ category, size = 'sm', categories }: Props) {
  // Если категории переданы снаружи — используем их, иначе берём из хука
  const { categories: hookCats } = useCategories()
  const cats = categories ?? hookCats

  const cat = cats.find(c => c.code === category)
  const label = cat?.label ?? category
  const color = cat?.color ?? '#6b7280'
  const bgColor = cat?.bg_color ?? '#1f2937'

  const padding = size === 'md' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-[10px]'

  return (
    <span
      className={`inline-flex items-center font-semibold rounded-full uppercase tracking-wide ${padding}`}
      style={{ color, backgroundColor: bgColor, border: `1px solid ${color}33` }}
    >
      {label}
    </span>
  )
}
