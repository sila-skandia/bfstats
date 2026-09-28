using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace api.Recordings;

/// <summary>
/// Keeps MVC from reading a multipart body before the action does. Its form value providers
/// read the whole form, files and all, as soon as an action with any parameter binds, which
/// both buffers a recording to disk a second time and leaves the action an empty stream.
/// The upload streams its parts itself (<see cref="RecordingUploadService"/>).
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class DisableFormValueModelBindingAttribute : Attribute, IResourceFilter
{
    public void OnResourceExecuting(ResourceExecutingContext context)
    {
        var factories = context.ValueProviderFactories;
        factories.RemoveType<FormValueProviderFactory>();
        factories.RemoveType<FormFileValueProviderFactory>();
        factories.RemoveType<JQueryFormValueProviderFactory>();
    }

    public void OnResourceExecuted(ResourceExecutedContext context)
    {
    }
}
