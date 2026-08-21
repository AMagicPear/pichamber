import { defineComponent } from "vue";

/** Simple checkmark icon (used to confirm an inline rename). */
export const Check = defineComponent({
  name: "Check",
  inheritAttrs: false,
  setup(_props, { attrs }) {
    return () => (
      <svg
        {...attrs}
        xmlns="http://www.w3.org/2000/svg"
        width="1em"
        height="1em"
        fill="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M9.55 17.9 4.05 12.4 5.46 11 9.55 15.1 18.54 6.1 19.95 7.5z" />
      </svg>
    );
  },
});
